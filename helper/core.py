"""Local-only OrcaSlicer integration. No printer control or G-code execution."""
from __future__ import annotations
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import zipfile
import xml.etree.ElementTree as ET
from opc import read_opc

KINDS = ('machine', 'process', 'filament')
RANGES = {
    'outer_wall_speed': ('process', 1, 600), 'inner_wall_speed': ('process', 1, 800),
    'sparse_infill_speed': ('process', 1, 1000), 'travel_speed': ('process', 1, 1200),
    'default_acceleration': ('process', 0, 30000), 'filament_max_volumetric_speed': ('filament', 1, 60),
    'layer_height': ('process', .05, .4), 'line_width': ('process', .2, .8),
    'enable_support': ('process', 0, 1), 'fan_max_speed': ('filament', 0, 100),
    'slow_down_layer_time': ('filament', 0, 60), 'sparse_infill_density': ('process', 0, 100),
    'bridge_speed': ('process', 1, 300), 'initial_layer_speed': ('process', 1, 150),
    'top_surface_speed': ('process', 1, 400), 'wall_loops': ('process', 1, 10),
}

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def resolve(name, catalog, stack=(), kind=None, scope=None):
    identity = (kind, scope, name)
    if identity in stack:
        raise ValueError('Preset inheritance cycle: ' + name)
    matches = [p for p in catalog if p.get('name') == name and (not kind or p.get('type') == kind)]
    local = [p for p in matches if scope and p.get('__sp_scope') == scope]
    if local:
        matches = local
    if len(matches) != 1:
        raise ValueError(f'Missing or ambiguous parent preset: {name}')
    p = matches[0]
    parent = p.get('inherits', '')
    if not isinstance(parent, str):
        raise ValueError('Expected a single named parent preset')
    context = (*stack, identity)
    result = resolve(parent, catalog, context, p['type'], p.get('__sp_scope')) if parent else {}
    includes = p.get('include', p.get('includes', []))
    if isinstance(includes, str):
        includes = [includes] if includes else []
    if not isinstance(includes, list):
        raise ValueError('Invalid included presets')
    for item in includes:
        result = {**result, **resolve(item, catalog, context, p['type'], p.get('__sp_scope'))}
    return {**result, **p}

def validate_bundle(bundle):
    if not isinstance(bundle, dict) or set(bundle) != set(KINDS):
        raise ValueError('Select exactly one machine, process and filament preset')
    for kind in KINDS:
        p = bundle[kind]
        if not isinstance(p, dict) or p.get('type') != kind or not isinstance(p.get('name'), str):
            raise ValueError(f'Invalid {kind} preset')
        # Slicer post-processing can execute arbitrary commands. Never accept it.
        for key in p:
            if ('post_process' in key.lower() or 'plugin' in key.lower()) and p[key]:
                raise ValueError('Post-processing commands and executable plugins are not permitted')
        if len(json.dumps(p)) > 2_000_000:
            raise ValueError('Preset exceeds size limit')
    for key, (kind, lo, hi) in RANGES.items():
        val = bundle[kind].get(key)
        if val is not None:
            for v in val if isinstance(val, list) else [val]:
                try:
                    n = float(str(v).rstrip('%'))
                except (ValueError, TypeError):
                    raise ValueError(f'{key} must be numeric') from None
                if not lo <= n <= hi:
                    raise ValueError(f'{key} is outside the supported tuning range')
    return bundle

def flatten(bundle, catalog=()):
    validate_bundle(bundle)
    result = {}
    for kind in KINDS:
        p = bundle[kind]
        others = [c for c in catalog if c.get('name') != p['name'] or c.get('type') != kind]
        effective = resolve(p['name'], [*others, p], kind=kind, scope=p.get('__sp_scope'))
        effective['inherits'] = ''
        for key in ('__sp_scope', 'include', 'includes', 'renamed_from'):
            effective.pop(key, None)
        result[kind] = effective
    validate_bundle(result)
    return result

def seconds(text):
    parts = re.findall(r'([\d.]+)\s*([dhms])', text)
    return sum(float(n) * {'d': 86400, 'h': 3600, 'm': 60, 's': 1}[u] for n, u in parts) if parts else None

def parse_gcode(text):
    m = re.search(r';\s*estimated printing time \(normal mode\)\s*=\s*([^\r\n]+)', text)
    duration = seconds(m[1]) if m else None
    if duration is None or duration <= 0:
        raise ValueError('Orca did not provide a normal-mode print-time estimate')
    result = {'seconds': duration, 'source': 'OrcaSlicer G-code · normal mode'}
    for label, key, multiplier in [('g', 'grams', 1), ('mm', 'meters', .001)]:
        m = re.search(r';\s*(?:total )?filament used \[' + label + r'\]\s*=\s*([\d., ]+)', text)
        if m:
            result[key] = sum(float(x) for x in m[1].split(',') if x.strip()) * multiplier
    return result

def catalog_from_roots(roots, warnings=None):
    """Only called after the local user grants profile-read permission."""
    profiles = []
    for root in roots:
        root = Path(root)
        if not root.exists():
            continue
        for file in root.rglob('*.json'):
            if file.stat().st_size > 2_000_000:
                continue
            try:
                p = json.loads(file.read_text(encoding='utf-8-sig'))
                if isinstance(p, dict) and p.get('type') in KINDS and p.get('name'):
                    p['__sp_scope'] = file.relative_to(root).parts[0] if file.parent != root else root.name
                    profiles.append(p)
            except (OSError, ValueError):
                continue
        for file in root.glob('*.opc'):
            try:
                profiles.extend(read_opc(file))
            except (OSError, ValueError) as exc:
                if warnings is not None:
                    warnings.append(f'{file.name}: {exc}')
    # Later roots win within a vendor/account namespace (OTA and user data).
    unique = {(p['type'], p['name'], p.get('__sp_scope')): p for p in profiles}
    return list(unique.values())

def inspect_model(path):
    path = Path(path).resolve()
    if path.suffix.lower() not in ('.stl', '.3mf') or not path.is_file() or path.stat().st_size > 200_000_000:
        raise ValueError('Select an STL or 3MF of at most 200 MB')
    if path.suffix.lower() == '.3mf':
        with zipfile.ZipFile(path) as z:
            if sum(i.file_size for i in z.infolist()) > 500_000_000:
                raise ValueError('3MF expanded size exceeds limit')
            for i in z.infolist():
                if i.filename.endswith(('.config', '.json', '.ini')):
                    data = z.read(i).decode('utf-8', errors='replace')
                    def unsafe(key, value):
                        return ('post_process' in str(key).lower() or 'plugin' in str(key).lower()) and value not in ('', None, [], {}, False)
                    def walk(value):
                        if isinstance(value, dict):
                            return any(unsafe(k, v) or walk(v) for k, v in value.items())
                        return isinstance(value, list) and any(walk(v) for v in value)
                    if data.lstrip().startswith('<'):
                        tree = ET.fromstring(data)
                        blocked = any(unsafe(e.attrib.get('key', e.tag), e.attrib.get('value', e.text or '')) for e in tree.iter())
                    elif data.lstrip().startswith(('{', '[')):
                        blocked = walk(json.loads(data))
                    else:
                        blocked = any(unsafe(k.strip(), v.strip()) for line in data.splitlines() if '=' in line for k, v in [line.split('=', 1)])
                    if blocked:
                        raise ValueError('3MF contains executable post-processing or plugins; export a clean model instead')
    return path

class Engine:
    def __init__(self, executable, catalog=()):
        self.executable = str(Path(executable).resolve())
        self.catalog = catalog
        self.cache = {}
        self.validated = {}

    def slice(self, bundle, model):
        bundle = flatten(bundle, self.catalog)
        path = inspect_model(model)
        model_bytes = path.read_bytes()
        model_hash = hashlib.sha256(model_bytes).hexdigest()
        settings_hash = digest(bundle)
        engine_files = [Path(self.executable)]
        dll = Path(self.executable).with_name('OrcaSlicer.dll')
        if dll.is_file():
            engine_files.append(dll)
        fingerprint = digest([(f.name, f.stat().st_mtime_ns, f.stat().st_size) for f in engine_files])
        key = digest([model_hash, settings_hash, self.executable, fingerprint])
        if key in self.cache:
            return self.cache[key]
        with tempfile.TemporaryDirectory(prefix='speed-printer-') as temp:
            work = Path(temp)
            snapshot = work / ('model' + path.suffix.lower())
            snapshot.write_bytes(model_bytes)
            inspect_model(snapshot)
            for kind, preset in bundle.items():
                (work / f'{kind}.json').write_text(json.dumps(preset), encoding='utf-8')
            output = work / 'output'
            output.mkdir()
            command = [self.executable, str(snapshot), '--load-settings', f'{work / "machine.json"};{work / "process.json"}',
                       '--load-filaments', str(work / 'filament.json'), '--arrange', '1', '--slice', '0',
                       '--outputdir', str(output), '--export-3mf', 'sliced.3mf']
            run = subprocess.run(command, cwd=work, capture_output=True, timeout=300,
                                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if run.returncode:
                # Logs may contain machine G-code or paths; keep response bounded.
                raise ValueError(f'OrcaSlicer failed (exit {run.returncode}). Check profile compatibility and local Orca logs.')
            texts = [f.read_text(encoding='utf-8', errors='replace') for f in output.rglob('*.gcode')]
            if not texts:
                for f in output.rglob('*.3mf'):
                    with zipfile.ZipFile(f) as z:
                        texts.extend(z.read(n).decode('utf-8', errors='replace') for n in z.namelist() if n.endswith('.gcode'))
            if not texts:
                raise ValueError('Orca produced no G-code. This Orca build may not support the requested CLI flags.')
            summaries = [parse_gcode(t) for t in texts]
            if len(summaries) != 1:
                raise ValueError('Use a single-plate project for a controlled comparison')
            result = {**summaries[0], 'modelHash': model_hash, 'settingsHash': settings_hash,
                      'engine': Path(self.executable).name, 'engineFingerprint': fingerprint, 'verifiedAt': time.time()}
            if len(self.cache) >= 128:
                self.cache.pop(next(iter(self.cache)))
            if len(self.validated) >= 128:
                self.validated.pop(next(iter(self.validated)))
            self.cache[key] = result
            self.validated[settings_hash] = bundle
            return result

    def analyze(self, bundle, target, model, keys):
        """One-at-a-time effects + cumulative greedy path; residual exposes interactions."""
        base = self.slice(bundle, model)
        current = copy.deepcopy(bundle)
        effects = []
        for key in keys:
            if key not in RANGES:
                raise ValueError('Unsupported analysis setting')
            kind = RANGES[key][0]
            if key not in target[kind]:
                continue
            trial = copy.deepcopy(bundle)
            trial[kind][key] = target[kind][key]
            result = self.slice(trial, model)
            effects.append({'key': key, 'savedSeconds': base['seconds'] - result['seconds']})
        effects.sort(key=lambda e: e['savedSeconds'], reverse=True)
        previous = base['seconds']
        for effect in effects:
            key = effect['key']
            kind = RANGES[key][0]
            current[kind][key] = target[kind][key]
            combined = self.slice(current, model)
            effect['conditionalSavedSeconds'] = previous - combined['seconds']
            previous = combined['seconds']
        return {'baseline': base, 'effects': effects, 'combinedSeconds': previous,
                'interactionResidualSeconds': base['seconds'] - previous - sum(e['savedSeconds'] for e in effects),
                'method': 'One-at-a-time target substitution followed by cumulative ranked substitution; order-dependent, constrained by Orca. Quality-changing settings are included only when explicitly selected.'}

def install_presets(bundle, name, directory, validated_hashes):
    """Exclusive file creation with rollback; no originals overwritten."""
    validate_bundle(bundle)
    if digest(bundle) not in validated_hashes:
        raise ValueError('Slice this exact effective bundle successfully before installation')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 _.-]{2,64}', name) or name.endswith(('.', ' ')) or re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', name, re.I):
        raise ValueError('Use a new name with 3–65 letters, digits, spaces, dots, dashes or underscores')
    directory = Path(directory).resolve()
    if not directory.is_dir():
        raise ValueError('Choose an existing Orca user account directory')
    paths, created = [], []
    try:
        for kind in KINDS:
            folder = directory / kind
            folder.mkdir(exist_ok=True)
            p = dict(bundle[kind])
            p.update(name=f'{name} - {kind}', inherits='', **{'from': 'User', 'is_custom_defined': '1'})
            p.pop('setting_id', None)
            if kind == 'machine':
                p['default_print_profile'] = f'{name} - process'
                p['default_filament_profile'] = [f'{name} - filament']
            else:
                p['compatible_printers'] = [f'{name} - machine']
            id_key = {'machine':'printer_settings_id','process':'print_settings_id','filament':'filament_settings_id'}[kind]
            p[id_key] = [p['name']] if kind == 'filament' else p['name']
            if kind == 'filament':
                p['filament_id'] = 'SP' + digest([name, bundle])[:8]
            path = folder / f'{name}.json'
            with path.open('x', encoding='utf-8') as f:
                created.append(path)
                json.dump(p, f, indent=2)
            paths.append(str(path))
    except Exception:
        for path in created:
            path.unlink(missing_ok=True)
        raise
    return paths
