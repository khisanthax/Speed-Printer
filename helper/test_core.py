import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from core import Engine, digest, flatten, install_presets, parse_gcode, resolve, validate_bundle

def bundle():
    return {k: {'type': k, 'name': k, 'inherits': ''} for k in ('machine','process','filament')}

class IntegrationContractTests(unittest.TestCase):
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

    def test_install_requires_exact_validation_and_never_overwrites(self):
        b=flatten(bundle())
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):install_presets(b,'Test preset',temp,{})
            paths=install_presets(b,'Test preset',temp,{digest(b):b})
            self.assertEqual(len(paths),3)
            original=Path(paths[0]).read_bytes()
            with self.assertRaises(FileExistsError):install_presets(b,'Test preset',temp,{digest(b):b})
            self.assertEqual(Path(paths[0]).read_bytes(),original)
            with self.assertRaises(ValueError):install_presets(b,'../escape',temp,{digest(b):b})

    def test_partial_install_rolls_back(self):
        b=flatten(bundle())
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp)/'process';folder.mkdir();(folder/'New preset.json').write_text('original')
            with self.assertRaises(FileExistsError):install_presets(b,'New preset',temp,{digest(b):b})
            self.assertFalse((Path(temp)/'machine'/'New preset.json').exists())
            self.assertEqual((folder/'New preset.json').read_text(),'original')

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
