"""Authenticated loopback companion. Run: python helper/server.py"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import os
from pathlib import Path
import secrets
import socket
import threading
import tkinter as tk
from tkinter import filedialog, messagebox
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler
from core import Engine, catalog_from_roots, flatten, install_presets, inspect_model
from auth import Trust
from storage import Store, MemoryStore
from discovery import Library
from shared_model import SharedModel

class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

def dialog(action):
    # Tk stays on its creating thread. Requests block until local permission resolves.
    root = tk.Tk()
    root.title('Speed Printer Helper')
    root.geometry('460x100')
    tk.Label(root, text='Speed Printer is waiting for your local confirmation.\nYour profiles and models stay on this PC.', padx=20, pady=20).pack()
    root.attributes('-topmost', True)
    root.update_idletasks()
    try:
        return action(root)
    finally:
        root.destroy()

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError('Moonraker redirects are disabled')

def moon_read(base, route, api_key=''):
    parsed = urlsplit(base)
    if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        raise ValueError('Use a plain Moonraker origin without credentials or a path')
    try:
        address = ipaddress.ip_address(parsed.hostname)
    except ValueError:
        raise ValueError('Use a numeric private LAN IP address for Moonraker (hostnames are disabled to prevent DNS rebinding)') from None
    networks = [ipaddress.ip_network(n) for n in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7')]
    if not any(address in n for n in networks):
        raise ValueError('Only private LAN Moonraker addresses are permitted (no loopback or link-local)')
    # Fixed read-only routes; no arbitrary proxying, redirects, G-code or mutations.
    if route not in ('/server/history/list?limit=100&order=desc', '/printer/objects/query?toolhead&configfile'):
        raise ValueError('Unsupported read-only route')
    request = Request(base.rstrip('/') + route, headers={'X-Api-Key': api_key} if api_key else {})
    with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=10) as response:
        data = response.read(5_000_001)
        if len(data) > 5_000_000:
            raise ValueError('Moonraker response exceeds limit')
        return json.loads(data)

class State:
    def __init__(self, args, test_mode=False, store=None):
        self.test_mode = test_mode
        self.store = store or (MemoryStore() if test_mode else Store(Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'SpeedPrinter'))
        self.trust = Trust(self.store)
        self.instance = secrets.token_hex(12)
        self.token = secrets.token_urlsafe(32)
        self.origins = set(args.origin)
        self.engine = Engine(args.orca)
        self.library = Library(self.store, args.orca)
        self.roots = [Path(args.orca).parent / 'resources' / 'profiles', Path(os.environ.get('APPDATA', '~')) / 'OrcaSlicer' / 'system', Path(os.environ.get('APPDATA', '~')) / 'OrcaSlicer' / 'user']
        self.models = {}
        self.jobs = {}
        self.pool = ThreadPoolExecutor(max_workers=1)
        self.lock = threading.Lock()
        self.read_permission = bool(self.store.data.get('profilePermission'))
        self.install_root = None
        if self.read_permission:
            self.engine.catalog = self.library.document.get('profiles',[])

    def submit(self, fn):
        if sum(j['state'] in ('pending', 'running') for j in self.jobs.values()) >= 4:
            raise ValueError('Job queue full; wait for slicing to complete')
        ident = secrets.token_hex(12)
        if len(self.jobs) >= 256:
            completed = next((key for key, job in self.jobs.items() if job['state'] in ('complete', 'failed')), None)
            if completed:
                del self.jobs[completed]
        self.jobs[ident] = {'state': 'pending'}
        def run():
            self.jobs[ident] = {'state': 'running'}
            try:
                self.jobs[ident] = {'state': 'complete', 'result': fn()}
            except Exception as exc:
                self.jobs[ident] = {'state': 'failed', 'error': str(exc)}
        self.pool.submit(run)
        return {'id': ident}

def handler_for(state):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'SpeedPrinter/0.1'
        def log_message(self, *args):
            pass  # Do not log tokens, file paths or private history.

        def permitted(self, auth=True):
            if self.headers.get('Host') != '127.0.0.1:8377':
                return False
            if self.headers.get('Origin') not in state.origins:
                return False
            return not auth or (hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + state.token) if state.test_mode else state.trust.permitted(self.headers.get('Origin'), self.headers.get('Authorization', '')))

        def reply(self, status, value):
            raw = json.dumps(value).encode()
            self.send_response(status)
            origin = self.headers.get('Origin')
            if origin in state.origins:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_OPTIONS(self):
            if not self.permitted(False):
                return self.reply(403, {'error': 'Origin or host denied'})
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
            self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Vary', 'Origin')
            self.end_headers()

        def do_GET(self):
            if not self.permitted():
                return self.reply(403, {'error': 'Origin, host or session token denied'})
            if self.path == '/health':
                return self.reply(200, {'version': '0.3.0', 'sharedLayout':True, 'instance':state.instance, 'orcaFound': Path(state.engine.executable).is_file()})
            if self.path == '/library':
                return self.reply(200, state.library.document)
            if self.path == '/workspace':
                return self.reply(200, state.store.data.get('workspace', {}))
            if self.path.startswith('/jobs/'):
                return self.reply(200, state.jobs.get(self.path[6:], {'state': 'missing'}))
            return self.reply(404, {'error': 'Unknown route'})

        def do_POST(self):
            auth_route = self.path in ('/auth/challenge', '/auth/pair', '/auth/resume')
            if not self.permitted(not auth_route):
                return self.reply(403, {'error': 'Origin, host or session token denied'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if length <= 0 or length > 8_000_000 or self.headers.get('Content-Type') != 'application/json':
                    raise ValueError('Expected JSON body under 8 MB')
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError('Expected a JSON object')
                # Serialize local permission dialogs and queue operations.
                with state.lock:
                    result = self.dispatch(body)
                return self.reply(200, result)
            except Exception as exc:
                return self.reply(400, {'error': str(exc)})

        def dispatch(self, body):
            if self.path == '/auth/challenge':
                if state.test_mode: return {'legacySession':True}
                return state.trust.challenge(self.headers['Origin'],body.get('clientId'))
            if self.path in ('/auth/pair','/auth/resume'):
                return state.trust.authenticate(self.headers['Origin'],body,self.path == '/auth/pair')
            if self.path == '/auth/revoke':
                state.trust.revoke(self.headers.get('Authorization'))
                return {'revoked':True}
            if self.path == '/workspace':
                # Snapshots preserve work across source changes; strip network credentials.
                saved = {}
                for key in ('a','b'):
                    if body.get(key): saved[key] = flatten(body[key],state.engine.catalog)
                state.store.update(workspace=saved)
                return {'saved':True}
            if self.path == '/profiles':
                if not state.read_permission:
                    state.read_permission = bool(dialog(lambda r: messagebox.askyesno('Speed Printer · profile access', 'Allow Speed Printer to read Orca preset JSON from the standard system and user directories? Data stays in this browser and local helper.', parent=r)))
                if not state.read_permission:
                    raise ValueError('Local profile-read permission declined')
                if not state.test_mode:
                    if not state.store.data.get('profilePermission'):
                        state.store.update(profilePermission=True)
                    if body.get('chooseRoot'):
                        folder = dialog(lambda r: filedialog.askdirectory(title='Select Orca data directory (contains OrcaSlicer.conf and user)', parent=r))
                        if folder:
                            state.store.update(dataDir=folder)
                            state.library = Library(state.store,state.engine.executable,folder)
                    result = state.library.refresh(bool(body.get('all')))
                    state.engine.catalog = state.library.catalog
                    return result
                if body.get('chooseRoot'):
                    folder = dialog(lambda r: filedialog.askdirectory(title='Select portable Orca data or profiles directory', parent=r))
                    if folder:
                        state.roots.append(Path(folder))
                warnings = []
                state.engine.catalog = catalog_from_roots(state.roots, warnings)
                return {'profiles': state.engine.catalog, 'warnings': warnings}
            if self.path == '/model':
                path = dialog(lambda r: filedialog.askopenfilename(title='Select common model / project (all parts auto-arranged)', filetypes=[('STL / 3MF', '*.stl *.3mf')], parent=r))
                if not path:
                    raise ValueError('No model selected')
                path = inspect_model(path)
                bundles=body.get('bundles')
                if bundles is not None:
                    if not isinstance(bundles,list) or len(bundles)!=3:
                        raise ValueError('Select complete A, B and C profiles before choosing the common model')
                    bundles=[flatten(b,state.engine.catalog) for b in bundles]
                    chosen=SharedModel(path,bundles)
                else:
                    chosen=path # Older clients and public engine fixtures.
                ident = secrets.token_hex(16)
                if len(state.models)>=8: state.models.pop(next(iter(state.models)))
                state.models[ident] = chosen
                return {'id': ident, 'name': path.name}
            if self.path in ('/slice', '/analyze', '/export-project'):
                if body.get('model') not in state.models:
                    raise ValueError('Select the common model in the local helper first')
                model = state.models[body['model']]
                bundle = flatten(body['bundle'], state.engine.catalog)
                if self.path == '/export-project':
                    path = dialog(lambda r: filedialog.asksaveasfilename(title='Export exact verified comparison project (new file only)', defaultextension='.3mf', filetypes=[('Orca project', '*.3mf')], initialfile='Speed Printer comparison.3mf', parent=r))
                    if not path:
                        raise ValueError('Project export cancelled')
                    if Path(path).suffix.lower() != '.3mf' or Path(path).exists():
                        raise ValueError('Choose a new .3mf filename; existing projects are never overwritten')
                    return state.submit(lambda: state.engine.slice(bundle, model, path))
                if self.path == '/slice':
                    return state.submit(lambda: state.engine.slice(bundle, model))
                target = flatten(body['target'], state.engine.catalog)
                keys = body.get('keys', [])
                if not isinstance(keys, list) or not 1 <= len(keys) <= 8 or len(set(keys)) != len(keys):
                    raise ValueError('Choose 1–8 unique settings for controlled analysis')
                return state.submit(lambda: state.engine.analyze(bundle, target, model, keys))
            if self.path == '/install':
                bundle = flatten(body['bundle'], state.engine.catalog)
                name = body['name']
                folder = dialog(lambda r: filedialog.askdirectory(title='Select Orca user account folder (contains machine / process / filament)', parent=r))
                if not folder:
                    raise ValueError('No installation directory selected')
                allowed = dialog(lambda r: messagebox.askyesno('Install new Orca presets?', f'Create three NEW profiles named {name!r} in:\n{folder}\n\nOriginal profiles will not be overwritten. Open a new Orca window afterward; keep unsaved projects open. Estimates do not establish hardware safety.', parent=r))
                if not allowed:
                    raise ValueError('Local installation confirmation declined')
                installed = install_presets(bundle, name, folder, state.engine.validated)
                installed_bundle = {kind: json.loads(Path(path).read_text(encoding='utf-8'))
                                    for kind, path in zip(('machine', 'process', 'filament'), installed)}
                return {'installed': installed, 'bundle': installed_bundle}
            if self.path in ('/history', '/limits'):
                route = '/server/history/list?limit=100&order=desc' if self.path == '/history' else '/printer/objects/query?toolhead&configfile'
                data = moon_read(body['url'], route, body.get('apiKey', ''))
                if self.path == '/limits':
                    status = data.get('result', {}).get('status', {})
                    keys = ('max_velocity', 'max_accel', 'max_z_velocity', 'max_z_accel', 'square_corner_velocity')
                    toolhead = status.get('toolhead', {})
                    printer = status.get('configfile', {}).get('settings', {}).get('printer', {})
                    return {'result': {'status': {'toolhead': {k: toolhead[k] for k in keys if k in toolhead}, 'configfile': {'settings': {'printer': {k: printer[k] for k in keys if k in printer}}}}}}
                return data
            raise ValueError('Unknown route')
    return Handler

def main():
    from tray import main as tray_main
    tray_main()

if __name__ == '__main__':
    main()
