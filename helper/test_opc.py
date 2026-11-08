import struct
import tempfile
import unittest
from pathlib import Path
import zlib
from opc import Reader, read_opc

def string(s):
    b=s.encode();return struct.pack('<Q',len(b))+b

class CacheFormatTests(unittest.TestCase):
    def test_minimal_cache_and_crc_fail_closed(self):
        # Synthetic original fixture: dictionary with one float, no VendorMap.
        body=struct.pack('<I',2)+string('FixtureVendor')+string('1.0.0')
        body+=struct.pack('<Q',1)+string('outer_wall_speed')
        body+=struct.pack('<QH',1,1)+struct.pack('<Q',0)+struct.pack('<Q',0)
        body+=struct.pack('<I',1)+string('Fixture process')+string('process/test.json')
        body+=struct.pack('<IHd',1,0,200.0)+string('')+struct.pack('<Q',0)
        body+=string('')+string('true')+string('')+string('')+struct.pack('<Q',0)
        body+=struct.pack('<IIQ',0,0,0)
        data=struct.pack('<IIQI',0x4f52435a,2,len(body),zlib.crc32(body))+body
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'FixtureVendor.opc';p.write_bytes(data)
            profiles=read_opc(p)
            self.assertEqual(profiles[0]['outer_wall_speed'],'200')
            self.assertEqual(profiles[0]['__sp_scope'],'FixtureVendor')
            p.write_bytes(data[:-1]+b'x')
            with self.assertRaises(ValueError):read_opc(p)
    def test_bounds_and_percent_vector(self):
        with self.assertRaises(ValueError):Reader(struct.pack('<Q',2_000_001)).string()
        r=Reader(struct.pack('<QdBdB',2,10.0,1,20.0,0))
        self.assertEqual(r.option(0x4005,[]),['10%','20'])

if __name__=='__main__':unittest.main()
