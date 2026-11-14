import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from core import Engine, digest, flatten
from shared_model import SharedModel, common_rectangle, layout_signature


def project(transform='1 0 0 0 1 0 0 0 1 20 20 0', copies=1, walls='3', uuid='first'):
    data=io.BytesIO()
    with zipfile.ZipFile(data,'w') as z:
        z.writestr('3D/3dmodel.model',f'<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="10"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build>'+''.join(f'<item objectid="1" transform="{transform}" printable="1" UUID="{uuid}"/>' for _ in range(copies))+'</build></model>')
        z.writestr('Metadata/project_settings.config',json.dumps({'printable_area':['0x0','100x0','100x100','0x100'],'printable_height':'100','bed_exclude_area':['0x0']}))
        z.writestr('Metadata/model_settings.config',f'<config><object id="1"><metadata key="name" value="Synthetic model"/><part id="1"><metadata key="wall_loops" value="{walls}"/></part></object><plate><model_instance><metadata key="object_id" value="0"/><metadata key="instance_id" value="0"/></model_instance></plate></config>')
    return data.getvalue()


def bundle(name='A',size=100):
    return {'machine':{'name':name,'type':'machine','printable_area':['0x0',f'{size}x0',f'{size}x{size}',f'0x{size}'],'printable_height':'100','bed_exclude_area':['0x0']},'process':{'name':'Process','type':'process','outer_wall_speed':'100'},'filament':{'name':'Material','type':'filament'}}


class SharedModelTests(unittest.TestCase):
    def test_signature_tracks_geometry_copies_placement_and_object_conditions(self):
        original=layout_signature(project())
        # Original Orca projects also contain unnamed mesh statistics, e.g.
        # <metadata face_count="3312"/>, alongside keyed print overrides.
        out=io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(project())) as source,zipfile.ZipFile(out,'w') as dest:
            for name in source.namelist():
                raw=source.read(name)
                if name=='Metadata/model_settings.config':
                    raw=raw.replace(b'<part id="1">',b'<part id="1"><metadata face_count="3312"/>')
                dest.writestr(name,raw)
        self.assertEqual(original,layout_signature(out.getvalue()))
        self.assertEqual(original,layout_signature(project(uuid='changed serialization UUID')))
        self.assertNotEqual(original,layout_signature(project(copies=2)))
        self.assertNotEqual(original,layout_signature(project(walls='4')))
        self.assertNotEqual(original,layout_signature(project(transform='1 0 0 0 1 0 0 0 1 21 20 0')))
    def test_equivalent_component_and_instance_transform_factoring(self):
        # Orca exports STL transforms differently before and after actual slicing.
        raw=project();out=io.BytesIO()
        import xml.etree.ElementTree as ET
        ns='{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}'
        with zipfile.ZipFile(io.BytesIO(raw)) as source,zipfile.ZipFile(out,'w') as dest:
            for entry in source.infolist():
                data=source.read(entry)
                if entry.filename.endswith('.model'):
                    root=ET.fromstring(data);resources=root.find(ns+'resources')
                    wrapper=ET.SubElement(resources,ns+'object',{'id':'2','type':'model'})
                    components=ET.SubElement(wrapper,ns+'components')
                    ET.SubElement(components,ns+'component',{'objectid':'1','transform':'1 0 0 0 1 0 0 0 1 10 10 0'})
                    item=root.find(ns+'build/'+ns+'item');item.set('objectid','2');item.set('transform','1 0 0 0 1 0 0 0 1 10 10 0')
                    data=ET.tostring(root)
                dest.writestr(entry,data)
        self.assertEqual(layout_signature(raw),layout_signature(out.getvalue()))
    def test_shared_area_and_embedded_bed_frame_do_not_change_geometry(self):
        a,b=bundle(),bundle('B',150)
        self.assertEqual(common_rectangle([a,b]),a['machine']['printable_area'])
        invalid=bundle();invalid['machine']['printable_area']=['0x0','100x0','20x100']
        with self.assertRaisesRegex(ValueError,'rectangular'):common_rectangle([a,invalid])
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'source.3mf';path.write_bytes(project())
            model=SharedModel(path,[a,b]);model.layout.write_bytes(project())
            before=model.original.read_bytes();path.write_bytes(b'changed source after choosing')
            output=model.slice_input(b)
            self.assertEqual(layout_signature(output),layout_signature(before))
            with zipfile.ZipFile(io.BytesIO(output)) as z:
                self.assertEqual(json.loads(z.read('Metadata/project_settings.config'))['printable_area'],b['machine']['printable_area'])
            self.assertEqual(model.original.read_bytes(),before)
    def test_arrange_once_then_slice_actual_profiles_without_rearranging(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'source.3mf';path.write_bytes(project())
            a,b=bundle(),bundle('B',150);model=SharedModel(path,[a,b,a])
            engine=Engine(__file__);calls=[]
            def run(command,**kwargs):
                calls.append(command)
                output=Path(command[command.index('--outputdir')+1])
                if '--slice' not in command:
                    self.assertEqual(command[command.index('--arrange')+1],'1')
                    (output/'common.3mf').write_bytes(project())
                else:
                    self.assertEqual(command[command.index('--arrange')+1],'0')
                    raw=Path(command[1]).read_bytes()
                    with zipfile.ZipFile(io.BytesIO(raw)) as source,zipfile.ZipFile(output/'sliced.3mf','w') as target:
                        for entry in source.infolist():target.writestr(entry,source.read(entry))
                        target.writestr('Metadata/plate_1.gcode','; estimated printing time (normal mode) = 1m 2s\nEXCLUDE_OBJECT_DEFINE NAME=fixture\n')
                return subprocess.CompletedProcess(command,0,b'',b'')
            with patch('core.subprocess.run',side_effect=run):
                first=engine.slice(a,model);second=engine.slice(b,model);reused=engine.slice(a,model)
            self.assertEqual(len(calls),3) # One arrangement, two actual slices, cached third.
            self.assertEqual(first,reused)
            self.assertEqual(first['layoutHash'],second['layoutHash'])
            self.assertEqual(first['modelHash'],second['modelHash'])
            self.assertEqual(first['projectObjectCount'],1)
            self.assertEqual(first['settingsHash'],digest(flatten(a)))
            self.assertEqual(path.read_bytes(),project())
    def test_changed_output_geometry_fails_closed_and_is_not_install_validated(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'source.3mf';path.write_bytes(project())
            b=bundle();model=SharedModel(path,[b,b,b]);engine=Engine(__file__)
            def run(command,**kwargs):
                output=Path(command[command.index('--outputdir')+1])
                if '--slice' not in command:(output/'common.3mf').write_bytes(project())
                else:(output/'sliced.3mf').write_bytes(project(copies=2))
                return subprocess.CompletedProcess(command,0,b'',b'')
            with patch('core.subprocess.run',side_effect=run):
                with self.assertRaisesRegex(ValueError,'changed the common geometry'):engine.slice(b,model)
            self.assertFalse(engine.validated)


if __name__=='__main__':unittest.main()
