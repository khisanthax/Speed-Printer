"""Bounded reader for Orca preset-cache format 2, not a general cereal loader.

Wire layout reference: OrcaSlicer src/libslic3r/PresetCacheFormat.{hpp,cpp},
Config.hpp and Preset.hpp. Unsupported versions/types fail closed.
"""
import math
from pathlib import Path
import struct
import zlib

class Reader:
    def __init__(self, data):
        self.data = data
        self.pos = 0

    def take(self, n):
        if not 0 <= n <= len(self.data) - self.pos:
            raise ValueError('Truncated Orca preset cache')
        value = self.data[self.pos:self.pos+n]
        self.pos += n
        return value

    def number(self, fmt):
        return struct.unpack('<' + fmt, self.take(struct.calcsize('<' + fmt)))[0]

    def count(self, fmt='Q'):
        n = self.number(fmt)
        if n > 100_000:
            raise ValueError('Orca cache collection exceeds limit')
        return n

    def string(self):
        n = self.number('Q')
        if n > 2_000_000:
            raise ValueError('Orca cache string exceeds limit')
        return self.take(n).decode('utf-8')

    def strings(self):
        return [self.string() for _ in range(self.count())]

    def vendor_map(self):
        for _ in range(self.count()):
            self.string()  # map key
            for _ in range(5):
                self.string()  # name, id, semver, update URL, changelog URL
            for _ in range(self.count()):
                for _ in range(3):
                    self.string()  # printer model id/name/model_id
                self.number('B')  # PrinterTechnology has unsigned-char wire type
                self.string()  # family
                self.strings()  # variants (each holds one string)
                self.strings()  # default materials
                self.strings()  # unsupported bed types
                for _ in range(9):
                    self.string()  # model / texture fields
            self.strings()  # default filaments (set)
            self.strings()  # SLA materials (set)

    def option(self, kind, enums):
        vector = bool(kind & 0x4000)
        base = kind & 0x3fff
        def scalar():
            if base in (1, 4, 5):
                n = self.number('d')
                percent = self.number('B') if base == 5 else base == 4
                return 'nil' if not math.isfinite(n) else format(n, '.15g') + ('%' if percent else '')
            if base == 2:
                n = self.number('i')
                return 'nil' if n == 2147483647 else str(n)
            if base == 3:
                return self.string()
            if base in (6, 7):
                return 'x'.join(format(self.number('d'), '.15g') for _ in range(2 if base == 6 else 3))
            if base == 8:
                n = self.number('B')
                return str(n) if n <= 1 else 'nil'
            raise ValueError(f'Unsupported Orca cache option type {kind}')
        if base == 9:
            values = []
            for _ in range(self.count('I')):
                idx = self.number('H')
                if idx == 0:
                    n = self.number('i')
                    values.append('nil' if n == 2147483647 else str(n))
                elif idx < len(enums):
                    values.append(enums[idx])
                else:
                    raise ValueError('Orca cache enum index out of bounds')
            if not vector and len(values) != 1:
                raise ValueError('Invalid scalar enum in Orca cache')
            return values if vector else values[0]
        if base in (10, 11):
            groups = []
            for _ in range(self.count()):
                values = []
                for _ in range(self.count()):
                    values.append('x'.join(format(self.number('d'), '.15g') for _ in range(2)) if base == 10 else str(self.number('i')))
                groups.append(','.join(values))
            return groups
        return [scalar() for _ in range(self.count())] if vector else scalar()

def read_opc(path):
    path = Path(path)
    if path.stat().st_size > 50_000_000:
        raise ValueError('Orca cache exceeds 50 MB')
    data = path.read_bytes()
    if len(data) < 20:
        raise ValueError('Truncated Orca cache header')
    magic, version, size, checksum = struct.unpack('<IIQI', data[:20])
    body = data[20:]
    if magic != 0x4F52435A or version != 2 or len(body) != size or zlib.crc32(body) != checksum:
        raise ValueError('Unsupported or corrupt Orca preset cache; use exported JSON')
    r = Reader(body)
    if r.number('I') != 2:
        raise ValueError('Unsupported Orca cache body version')
    vendor, _version = r.string(), r.string()
    keys = r.strings()
    types = [r.number('H') for _ in range(r.count())]
    enums = r.strings()
    if len(keys) != len(types):
        raise ValueError('Invalid Orca cache dictionary')
    r.vendor_map()
    profiles = []
    for kind in ('process', 'filament', 'machine'):
        for _ in range(r.count('I')):
            name, _subpath = r.string(), r.string()
            p = {'name': name, 'type': kind, '__sp_scope': vendor, 'from': 'system'}
            for _ in range(r.count('I')):
                idx = r.number('H')
                if idx >= len(keys):
                    raise ValueError('Orca cache option index out of bounds')
                p[keys[idx]] = r.option(types[idx], enums)
            p['inherits'] = r.string()
            p['include'] = r.strings()
            p['description'], p['instantiation'], p['setting_id'], p['filament_id'] = [r.string() for _ in range(4)]
            p['renamed_from'] = r.strings()
            profiles.append(p)
    r.number('Q')  # parse error count from source generation
    if r.pos != len(body):
        raise ValueError('Unexpected trailing Orca cache bytes')
    return profiles
