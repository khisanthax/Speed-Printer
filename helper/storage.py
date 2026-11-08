"""Per-user local state protected by Windows DPAPI; never a public repo file."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import threading


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def protect(data, decrypt=False):
    if os.name != 'nt':
        raise RuntimeError('Persistent helper state requires Windows protected storage')
    buffer = ctypes.create_string_buffer(data)
    incoming = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = Blob()
    crypt = ctypes.windll.crypt32
    fn = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    fn.restype = wintypes.BOOL
    if not fn(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(outgoing.data, outgoing.size)
    finally:
        free = ctypes.windll.kernel32.LocalFree
        free.argtypes = [ctypes.c_void_p]
        free.restype = ctypes.c_void_p
        free(outgoing.data)


class Store:
    def __init__(self, directory):
        self.path = Path(directory) / 'state.dpapi'
        self.lock = threading.RLock()
        self.data = {}
        if self.path.exists():
            self.data = json.loads(protect(self.path.read_bytes(), decrypt=True))

    def update(self, **values):
        with self.lock:
            updated = {**self.data, **values}
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix('.tmp')
            temporary.write_bytes(protect(json.dumps(updated).encode('utf-8')))
            os.replace(temporary, self.path)
            self.data = updated


class MemoryStore:
    """Explicit test-only store, never selected by the production launcher."""
    def __init__(self):
        self.data = {}
    def update(self, **values):
        self.data.update(values)
