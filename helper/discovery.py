"""Incremental local preset discovery, driven by Orca's configuration, not recency guesses."""
import copy
import json
import os
from pathlib import Path
import time
from core import KINDS, digest, resolve, without_connection_data
from opc import read_opc


def stable_read(path):
    for _ in range(3):
        before = path.stat()
        if before.st_size > 40_000_000:
            raise ValueError('Profile container exceeds size limit')
        raw = path.read_bytes()
        after = path.stat()
        if (before.st_mtime_ns, before.st_size) == (after.st_mtime_ns, after.st_size):
            return raw
        time.sleep(.05)
    raise ValueError('Orca is updating this file; retained previous snapshot')


def config_at(directory):
    path = Path(directory) / 'OrcaSlicer.conf'
    if not path.exists():
        return {}
    text = stable_read(path).decode('utf-8-sig')
    return json.loads(text[text.index('{'):text.rindex('}')+1])


def compatible(preset, machine, original_parent='', process=None):
    """Orca's explicit list precedes its expression; a user printer also matches its parent.

    Arbitrary condition expressions aren't evaluated by Python. Unsupported conditions
    are unknown, not silently declared compatible. Remembered Orca selections are shown.
    """
    names = preset.get('compatible_printers', [])
    if names and not (machine['name'] in names or bool(original_parent and original_parent in names)):
        return False
    condition = preset.get('compatible_printers_condition', '')
    if not names and condition:
        return None
    if process and preset.get('compatible_prints') and process['name'] not in preset['compatible_prints']:
        return False
    if preset.get('compatible_prints_condition'):
        return None
    return True


class Library:
    def __init__(self, store, executable, data_dir=None):
        self.store = store
        self.executable = Path(executable)
        self.directory = Path(data_dir or store.data.get('dataDir') or Path(os.environ.get('APPDATA', Path.home())) / 'OrcaSlicer')
        self.files = {}
        self.catalog = []
        self.document = store.data.get('library', {'imported':False, 'profiles':[], 'printers':[]})
        self.refresh_count = 0
        self.fingerprint = None

    def account(self, config):
        root = self.directory / 'user'
        folders = [p for p in root.iterdir() if p.is_dir()] if root.exists() else []
        saved = config.get('app', {}).get('preset_folder', '')
        # Do not allow a config string to escape the account directory.
        if saved and Path(saved).name == saved and (root / saved) in folders:
            return root / saved
        current = config.get('presets', {}).get('machine', '')
        matching = [p for p in folders if (p / 'machine' / (current + '.json')).is_file()] if current else []
        if len(matching) == 1:
            return matching[0]
        if len(folders) == 1:
            return folders[0]
        if (root / 'default') in folders and not saved and not matching:
            # Orca's offline default, only when cloud/account selection isn't present.
            return root / 'default'
        raise ValueError('Orca account is ambiguous. Select the active account folder in helper Settings.')

    def refresh(self, all_profiles=False):
        if not self.store.data.get('profilePermission'):
            return self.document
        warnings = []
        try:
            config = config_at(self.directory)
            override = self.store.data.get('accountDir')
            account = Path(override) if override else self.account(config)
            roots = [self.executable.parent / 'resources' / 'profiles', self.directory / 'system', account]
            profiles, next_files = [], {}
            for root in roots:
                if not root.exists():
                    continue
                for file in [*root.rglob('*.json'), *root.glob('*.opc')]:
                    key = str(file)
                    try:
                        stat = file.stat(); stamp = (stat.st_mtime_ns, stat.st_size)
                        previous = self.files.get(key)
                        if previous and previous[0] == stamp:
                            parsed = previous[1]
                        elif file.suffix == '.opc':
                            # OPC reader checks the container; verify no write occurred during decode.
                            parsed = read_opc(file)
                            if stamp != (file.stat().st_mtime_ns, file.stat().st_size):
                                raise ValueError('Container changed during read')
                        else:
                            p = json.loads(stable_read(file).decode('utf-8-sig'))
                            if not isinstance(p, dict):
                                continue
                            kind = p.get('type') or next((part for part in reversed(file.relative_to(root).parts[:-1]) if part in KINDS), None)
                            parsed = []
                            if kind in KINDS and p.get('name'):
                                p['type'] = kind
                                p['__sp_scope'] = account.name if root == account else file.relative_to(root).parts[0]
                                if root == account:
                                    p['name'] = file.stem  # Orca's on-disk identity.
                                parsed = [p]
                        source = 'User' if root == account else 'System'
                        parsed = [{**without_connection_data(p), '__sp_source':source} for p in parsed]
                        next_files[key] = (stamp, parsed)
                        profiles.extend(parsed)
                    except (OSError, ValueError, KeyError) as exc:
                        warnings.append(f'{file.name}: updating or unreadable; retained last good settings')
                        if key in self.files:
                            next_files[key] = self.files[key]; profiles.extend(self.files[key][1])
            self.files = next_files
            fingerprint = digest([config.get('app',{}).get('preset_folder'),config.get('presets'),config.get('orca_presets'),config.get('models'),config.get('filaments'),[(k,v[0]) for k,v in next_files.items()]])
            if not all_profiles and fingerprint == self.fingerprint and not warnings:
                return self.document
            self.catalog = list({(p['type'],p['name'],p.get('__sp_scope')):p for p in profiles}.values())
            if all_profiles:
                # Advanced is the raw inheritance catalog, not a cross product of
                # every installed printer and material. Browser resolves chosen parents.
                return {'imported':True,'profiles':self.catalog,'printers':[], 'warnings':warnings}
            remembered = {r['machine']:r for r in config.get('orca_presets', []) if isinstance(r,dict) and r.get('machine')}
            current = config.get('presets', {}).get('machine', '')
            enabled_materials = config.get('filaments', [])
            if isinstance(enabled_materials,dict): enabled_materials = list(enabled_materials)
            models = config.get('models', [])
            effective, parents = {}, {}
            resolved = {}
            def effective_preset(p):
                key=(p['type'],p.get('__sp_scope'),p['name'])
                if key not in resolved:
                    resolved[key]=resolve(p['name'],self.catalog,kind=p['type'],scope=p.get('__sp_scope'))
                return dict(resolved[key])
            for p in self.catalog:
                if p['type'] == 'machine' and p.get('instantiation') != 'false':
                    try:
                        q = effective_preset(p)
                        enabled = any(m.get('model') == q.get('printer_model') and str(q.get('printer_variant','')) in str(m.get('nozzle_diameter','')).split(';') for m in models if isinstance(m,dict))
                        if p['__sp_source'] == 'User' or enabled or all_profiles:
                            ident = digest(['machine',p.get('__sp_scope'),p['name']])[:24]
                            q.update(__sp_id=ident, __sp_source=p['__sp_source'], inherits='')
                            q.pop('include',None);q.pop('includes',None)
                            q['__sp_hash'] = digest(q)
                            effective[ident] = q; parents[ident] = p.get('inherits','')
                    except ValueError:
                        warnings.append(f"{p['name']}: unresolved printer inheritance")
            printers = []
            for ident,machine in list(effective.items()):
                choices = {'process':[], 'filament':[]}
                r = remembered.get(machine['name'], {})
                picks = {'process':r.get('process') or machine.get('default_print_profile',''), 'filament':r.get('filament') or r.get('filament_01') or next(iter(machine.get('default_filament_profile',[])), '')}
                for p in self.catalog:
                    kind = p['type']
                    if kind not in choices or p.get('instantiation') == 'false': continue
                    named = p['name'] == picks[kind] or picks[kind] in p.get('renamed_from',[])
                    if not (all_profiles or p['__sp_source']=='User' or named or (kind=='filament' and p['name'] in enabled_materials)):
                        continue
                    try:
                        q = effective_preset(p)
                        match = compatible(q,machine,parents[ident])
                        if not all_profiles and match is not True and not named: continue
                        pid = digest([kind,p.get('__sp_scope'),p['name']])[:24]
                        q.update(__sp_id=pid,__sp_source=p['__sp_source'],inherits='')
                        for k in ('include','includes','renamed_from'): q.pop(k,None)
                        q['__sp_hash'] = digest(q)
                        effective[pid] = q
                        choices[kind].append({'id':pid,'name':p['name'],'source':p['__sp_source'], 'compatibility':'matched' if match is True else 'Orca remembered / condition not evaluated' if named else 'unknown' if match is None else 'incompatible'})
                        if named: picks[kind] = pid
                    except ValueError:
                        if named: warnings.append(f"{p['name']}: remembered selection is missing a parent")
                selected = {k:v if any(c['id']==v for c in choices[k]) else '' for k,v in picks.items()}
                printers.append({'id':ident,'name':machine['name'],'source':machine['__sp_source'], 'current':machine['name']==current, 'remembered':bool(r), **choices, 'selected':selected})
            document = {'imported':True,'profiles':list(effective.values()),'printers':sorted(printers,key=lambda p:(not p['current'],p['source']!='User',p['name'])), 'current':current,'account':account.name, 'warnings':warnings, 'note':'Orca saves per-printer remembered selections, not a reliable recent-use timeline. Project-only selections may have no saved preset. Conditions not evaluated are labeled; no recency inferred from timestamps.'}
            self.refresh_count += 1
            if not all_profiles:
                # Avoid DPAPI rewrite when nothing changed.
                if document != self.document: self.store.update(library=document)
                self.document = document
                self.fingerprint = fingerprint if not warnings else None
            return document
        except (OSError, ValueError, KeyError) as exc:
            return {**self.document, 'warnings':[str(exc)], 'stale':True}
