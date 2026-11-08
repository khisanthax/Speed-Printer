"""Test-only fixture server: public system presets and a generated cube, never user roots."""
import argparse
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'helper'))
import server

def main():
    orca=sys.argv[1]
    state=server.State(argparse.Namespace(orca=orca,origin=['http://127.0.0.1:5173']),test_mode=True)
    state.roots=[Path(orca).parent/'resources/profiles']
    state.read_permission=True  # Test fixture may only read bundled public presets.
    with tempfile.TemporaryDirectory() as temp:
        cube=Path(temp)/'cube.stl'
        vertices=[(0,0,0),(20,0,0),(20,20,0),(0,20,0),(0,0,20),(20,0,20),(20,20,20),(0,20,20)]
        faces=[(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
        cube.write_text('solid cube\n'+''.join('facet normal 0 0 0\nouter loop\n'+''.join('vertex %s %s %s\n'%vertices[i] for i in face)+'endloop\nendfacet\n' for face in faces)+'endsolid cube\n')
        server.dialog=lambda action: str(cube)  # Only model picker used in this test.
        http=server.LocalServer(('127.0.0.1',8377),server.handler_for(state))
        print(json.dumps({'token':state.token}),flush=True)
        http.serve_forever()

if __name__=='__main__':main()
