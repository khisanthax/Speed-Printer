r"""Optional real-engine verification using only bundled PUBLIC presets and an original cube.

python helper/smoke_orca.py --orca "C:\Program Files\OrcaSlicer\orca-slicer.exe"
Does not read user profiles, touch printers or install into Orca user directories.
"""
import argparse
import copy
import json
from pathlib import Path
import tempfile
from core import Engine, catalog_from_roots, flatten, install_presets, resolve

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--orca',required=True)
    args=parser.parse_args()
    executable=Path(args.orca).resolve()
    warnings=[]
    catalog=catalog_from_roots([executable.parent/'resources/profiles'],warnings)
    names={'machine':'Sovol SV08 0.4 nozzle','process':'0.20mm Standard @Sovol SV08'}
    filament=next((p['name'] for p in catalog if p['type']=='filament' and p['name']=='Generic PLA @Sovol SV08'),'Sovol SV08 PLA')
    names['filament']=filament
    bundle=flatten({k:resolve(n,catalog,kind=k,scope='Sovol') for k,n in names.items()},catalog)
    vertices=[(0,0,0),(20,0,0),(20,20,0),(0,20,0),(0,0,20),(20,0,20),(20,20,20),(0,20,20)]
    faces=[(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
    stl='solid cube\n'+''.join('facet normal 0 0 0\nouter loop\n'+''.join('vertex %s %s %s\n'%vertices[i] for i in face)+'endloop\nendfacet\n' for face in faces)+'endsolid cube\n'
    engine=Engine(executable,catalog)
    with tempfile.TemporaryDirectory(prefix='speed-printer-smoke-') as temp:
        model=Path(temp)/'cube.stl';model.write_text(stl)
        baseline=engine.slice(bundle,model)
        target=copy.deepcopy(bundle)
        target['process']['outer_wall_speed']='250'
        analysis=engine.analyze(bundle,target,model,['outer_wall_speed','inner_wall_speed'])
        installed=install_presets(bundle,'Speed Printer smoke test',temp,engine.validated)
        assert len(installed)==3 and baseline['seconds']>0
        installed_bundle={kind:json.loads(Path(path).read_text()) for kind,path in zip(('machine','process','filament'),installed)}
        installed_result=engine.slice(installed_bundle,model)
        assert installed_result['seconds']==baseline['seconds'], 'Renaming should preserve sliced behavior'
        print(json.dumps({'systemPresetCount':len(catalog),'cacheWarnings':warnings,'baseline':baseline,'analysis':analysis,'temporaryInstallCount':len(installed),'renamedPresetReSliceSeconds':installed_result['seconds']},indent=2))

if __name__=='__main__':main()
