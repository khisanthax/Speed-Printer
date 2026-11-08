import copy
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch
from core import Engine, catalog_from_roots, digest, flatten, install_presets, inspect_model, parse_gcode, prepare_model, resolve, validate_bundle
import io
import subprocess

def bundle():
    return {k: {'type': k, 'name': k, 'inherits': ''} for k in ('machine','process','filament')}

class IntegrationContractTests(unittest.TestCase):
    def test_export_is_verified_new_project_and_never_replaces_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);model=root/'part.stl';model.write_bytes(b'original model')
            destination=root/'comparison.3mf'
            engine=Engine(__file__)
            b=bundle();b['process']['default_acceleration']='20000';b['machine']['machine_max_acceleration_extruding']=['10000']
            def run(command, **kwargs):
                output=Path(command[command.index('--outputdir')+1])
                with zipfile.ZipFile(output/'sliced.3mf','w') as z:
                    z.writestr('Metadata/plate_1.gcode','; estimated printing time (normal mode) = 1m 2s\nEXCLUDE_OBJECT_DEFINE NAME=part\n')
                    z.writestr('3D/3dmodel.model',b'synthetic geometry')
                return subprocess.CompletedProcess(command,0,b'',b'')
            with patch('core.subprocess.run',side_effect=run):
                result=engine.slice(b,model,destination)
                original=destination.read_bytes()
                self.assertEqual(result['seconds'],62)
                self.assertEqual(result['objectCount'],1)
                self.assertEqual(result['exportedProject'],'comparison.3mf')
                self.assertTrue(any('exceeds configured extruding limit' in n for n in result['notes']))
                with self.assertRaises(FileExistsError):engine.slice(b,model,destination)
                self.assertEqual(destination.read_bytes(),original)
            self.assertEqual(model.read_bytes(),b'original model')

    def test_motion_limits_are_explicit_simulations(self):
        b=bundle();b['machine'].update(machine_max_jerk_x=['10'],machine_max_jerk_y=['10'],machine_max_acceleration_extruding=['10000'])
        target=copy.deepcopy(b);target['machine'].update(machine_max_jerk_x=['20'],machine_max_jerk_y=['20'],machine_max_acceleration_extruding=['20000'])
        engine=Engine('unused')
        def sliced(p, model):
            fast=p['machine']['machine_max_jerk_x']==['20'];accel=p['machine']['machine_max_acceleration_extruding']==['20000']
            return {'seconds':1000-100*fast-50*accel-20*(fast and accel)}
        with patch.object(engine,'slice',side_effect=sliced):
            result=engine.analyze(b,target,'unused',['xy_jerk_limits','extruding_acceleration_limit'])
        self.assertTrue(all(e['simulationOnly'] for e in result['effects']))
        self.assertEqual(result['combinedSeconds'],830)
        self.assertEqual(b['machine']['machine_max_jerk_x'],['10'])
    def test_personal_project_inactive_raft_repair_preserves_geometry(self):
        original = io.BytesIO()
        with zipfile.ZipFile(original, 'w') as z:
            z.writestr('Metadata/project_settings.config', json.dumps({'raft_layers':'0', 'raft_first_layer_expansion':'-1', 'wall_loops':'4'}))
            z.writestr('3D/3dmodel.model', b'original geometry and placement')
        data = original.getvalue()
        fixed, notes = prepare_model(data, '.3mf', bundle())
        with zipfile.ZipFile(io.BytesIO(fixed)) as z:
            self.assertEqual(z.read('3D/3dmodel.model'), b'original geometry and placement')
            self.assertEqual(json.loads(z.read('Metadata/project_settings.config')), {'raft_layers':'0', 'raft_first_layer_expansion':'0', 'wall_loops':'4'})
        self.assertEqual(original.getvalue(), data)
        self.assertIn('inactive legacy raft', notes[-1])
        enabled=bundle(); enabled['process']['raft_layers']='1'
        with self.assertRaisesRegex(ValueError,'rafts are enabled'): prepare_model(data,'.3mf',enabled)

    def test_connection_credentials_do_not_reach_effective_presets(self):
        b=bundle(); b['machine'].update(print_host='private', printhost_apikey='secret', machine_start_gcode='G28')
        clean=flatten(b)
        self.assertNotIn('printhost_apikey',clean['machine'])
        self.assertNotIn('print_host',clean['machine'])
        self.assertEqual(clean['machine']['machine_start_gcode'],'G28')
    def test_user_preset_kind_comes_from_its_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for kind in ('machine','process','filament'):
                folder=root/'default'/kind;folder.mkdir(parents=True)
                (folder/'Personal preset.json').write_text(json.dumps({'name':f'Personal {kind}','inherits':''}))
            (root/'unrelated.json').write_text(json.dumps({'name':'Not a profile'}))
            profiles=catalog_from_roots([root])
            self.assertEqual({p['type'] for p in profiles},{'machine','process','filament'})
            self.assertEqual(len(profiles),3)
    def test_renamed_system_parent_remains_resolvable(self):
        profiles=[{'name':'Modern material','type':'filament','renamed_from':['Legacy material'],'filament_type':['PETG']}, {'name':'Personal material','type':'filament','inherits':'Legacy material'}]
        self.assertEqual(resolve('Personal material',profiles)['filament_type'],['PETG'])
        self.assertNotIn('renamed_from',resolve('Personal material',profiles))
    def test_inheritance_and_missing_parent(self):
        p = [{'name':'base','type':'process','outer_wall_speed':'100'}, {'name':'child','type':'process','inherits':'base'}]
        self.assertEqual(resolve('child',p)['outer_wall_speed'],'100')
        with self.assertRaises(ValueError): resolve('bad',p)
        p[0]['inherits']='child'
        with self.assertRaises(ValueError): resolve('child',p)

    def test_vendor_scoped_parents_and_includes(self):
        p=[{'name':'base','type':'process','__sp_scope':'A','outer_wall_speed':'100'},
           {'name':'base','type':'process','__sp_scope':'B','outer_wall_speed':'500'},
           {'name':'mixin','type':'process','__sp_scope':'A','inner_wall_speed':'200'},
           {'name':'child','type':'process','__sp_scope':'A','inherits':'base','include':['mixin']}]
        r=resolve('child',p,kind='process',scope='A')
        self.assertEqual(r['outer_wall_speed'],'100')
        self.assertEqual(r['inner_wall_speed'],'200')

    def test_gcode_metrics_are_only_from_engine(self):
        r=parse_gcode('; estimated printing time (normal mode) = 1h 2m 3s\n; total filament used [g] = 2.5\n; filament used [mm] = 1200\n')
        self.assertEqual(r['seconds'],3723)
        self.assertEqual(r['grams'],2.5)
        self.assertEqual(r['meters'],1.2)
        self.assertNotIn('breakdown',r)
        with self.assertRaises(ValueError):parse_gcode('; no timing')

    def test_validation_rejects_execution_and_invalid_numbers(self):
        b=bundle();b['process']['post_process']='cmd.exe'
        with self.assertRaises(ValueError):validate_bundle(b)
        b=bundle();b['process']['travel_speed']='nan'
        with self.assertRaises(ValueError):validate_bundle(b)
        b['process']['travel_speed']='99999'
        with self.assertRaises(ValueError):validate_bundle(b)

    def test_3mf_embedded_executable_settings_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            model=Path(temp)/'project.3mf'
            for config in ('{"nested":{"post_process":"execute something"}}', '<config><metadata key="plugins" value="unsafe-script"/></config>'):
                with zipfile.ZipFile(model,'w') as z:z.writestr('Metadata/project_settings.config',config)
                with self.assertRaises(ValueError):inspect_model(model)
            with zipfile.ZipFile(model,'w') as z:z.writestr('Metadata/project_settings.config','{"post_process": "", "plugins": []}')
            self.assertEqual(inspect_model(model),model.resolve())

    def test_install_requires_exact_validation_and_never_overwrites(self):
        b=flatten(bundle())
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):install_presets(b,'Test preset',temp,{})
            paths=install_presets(b,'Test preset',temp,{digest(b):b})
            self.assertEqual(len(paths),3)
            for path in paths:
                preset=json.loads(Path(path).read_text())
                self.assertEqual(Path(path).stem,preset['name'])
            machine=json.loads(Path(paths[0]).read_text())
            process=json.loads(Path(paths[1]).read_text())
            self.assertEqual(machine['default_print_profile'],Path(paths[1]).stem)
            self.assertEqual(process['compatible_printers'],[Path(paths[0]).stem])
            original=Path(paths[0]).read_bytes()
            with self.assertRaises(FileExistsError):install_presets(b,'Test preset',temp,{digest(b):b})
            self.assertEqual(Path(paths[0]).read_bytes(),original)
            with self.assertRaises(ValueError):install_presets(b,'../escape',temp,{digest(b):b})

    def test_partial_install_rolls_back(self):
        b=flatten(bundle())
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp)/'process';folder.mkdir();(folder/'New preset - process.json').write_text('original')
            with self.assertRaises(FileExistsError):install_presets(b,'New preset',temp,{digest(b):b})
            self.assertFalse((Path(temp)/'machine'/'New preset - machine.json').exists())
            self.assertEqual((folder/'New preset - process.json').read_text(),'original')

    def test_controlled_analysis_reports_interactions(self):
        b=bundle();b['process'].update(outer_wall_speed='100',inner_wall_speed='100')
        target=copy.deepcopy(b);target['process'].update(outer_wall_speed='200',inner_wall_speed='200')
        engine=Engine('unused')
        def sliced(p, model):
            a=int(p['process']['outer_wall_speed'])==200;c=int(p['process']['inner_wall_speed'])==200
            return {'seconds':1000-100*a-50*c-20*(a and c)}
        with patch.object(engine,'slice',side_effect=sliced):
            r=engine.analyze(b,target,'unused',['outer_wall_speed','inner_wall_speed'])
        self.assertEqual(r['effects'][0]['savedSeconds'],100)
        self.assertEqual(r['effects'][1]['conditionalSavedSeconds'],70)
        self.assertEqual(r['interactionResidualSeconds'],20)

if __name__=='__main__':unittest.main()
