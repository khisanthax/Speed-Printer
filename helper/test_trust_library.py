import base64
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives import hashes
from auth import Trust
from storage import Store, MemoryStore
from discovery import Library, compatible

def encoded(raw):return base64.urlsafe_b64encode(raw).decode().rstrip('=')

class TrustTests(unittest.TestCase):
    def setUp(self):
        self.store=MemoryStore();self.trust=Trust(self.store)
        self.key=ec.generate_private_key(ec.SECP256R1());n=self.key.public_key().public_numbers()
        self.jwk={'kty':'EC','crv':'P-256','x':encoded(n.x.to_bytes(32,'big')),'y':encoded(n.y.to_bytes(32,'big'))}
        self.origin='https://example.test';self.client='test-browser-identity'
    def proof(self,trust=None):
        trust=trust or self.trust;c=trust.challenge(self.origin,self.client)
        r,s=utils.decode_dss_signature(self.key.sign(c['message'].encode(),ec.ECDSA(hashes.SHA256())))
        return {'clientId':self.client,'challenge':c['id'],'signature':encoded(r.to_bytes(32,'big')+s.to_bytes(32,'big'))}
    def test_persist_restart_resume_replay_origin_and_revoke(self):
        body={**self.proof(),'code':self.trust.pairing_code(),'publicKey':self.jwk}
        first=self.trust.authenticate(self.origin,body,True)['token']
        self.assertTrue(self.trust.permitted(self.origin,'Bearer '+first))
        self.assertNotIn(first,json.dumps(self.store.data));self.assertNotIn(body['code'],json.dumps(self.store.data))
        with self.assertRaises(ValueError):self.trust.authenticate(self.origin,body,True)
        restarted=Trust(self.store)
        self.assertFalse(restarted.permitted(self.origin,'Bearer '+first))
        second=restarted.authenticate(self.origin,self.proof(restarted))['token']
        self.assertTrue(restarted.permitted(self.origin,'Bearer '+second))
        self.assertFalse(restarted.permitted('https://evil.test','Bearer '+second))
        wrong=self.proof(restarted)
        with self.assertRaises(ValueError):restarted.authenticate('https://evil.test',wrong)
        restarted.revoke('Bearer '+second)
        with self.assertRaises(ValueError):restarted.authenticate(self.origin,self.proof(restarted))
    def test_code_consumed_and_private_jwk_rejected(self):
        code=self.trust.pairing_code()
        with self.assertRaises(ValueError):self.trust.authenticate(self.origin,{**self.proof(),'code':code,'publicKey':{**self.jwk,'d':'secret'}},True)
        self.trust.authenticate(self.origin,{**self.proof(),'code':code,'publicKey':self.jwk},True)
        with self.assertRaises(ValueError):self.trust.authenticate(self.origin,{**self.proof(),'code':code,'publicKey':self.jwk},True)
    def test_multiple_tabs_do_not_revoke_each_other_and_challenges_expire(self):
        first=self.trust.authenticate(self.origin,{**self.proof(),'code':self.trust.pairing_code(),'publicKey':self.jwk},True)['token']
        second=self.trust.authenticate(self.origin,self.proof())['token']
        self.assertTrue(self.trust.permitted(self.origin,'Bearer '+first))
        self.assertTrue(self.trust.permitted(self.origin,'Bearer '+second))
        expired=self.proof();self.trust.challenges[expired['challenge']]['until']=0
        with self.assertRaises(ValueError):self.trust.authenticate(self.origin,expired)
    @unittest.skipUnless(os.name=='nt','Windows DPAPI')
    def test_dpapi_roundtrip_not_plaintext(self):
        with tempfile.TemporaryDirectory() as temp:
            s=Store(temp);s.update(trusted={'test':'private-value'})
            self.assertNotIn(b'private-value',s.path.read_bytes())
            self.assertEqual(Store(temp).data,s.data)

class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.account=self.root/'data/user/default';self.system=self.root/'resources/profiles/Vendor'
        self.store=MemoryStore();self.store.update(profilePermission=True)
        self.config={'app':{'preset_folder':'default'},'presets':{'machine':'My printer'},'orca_presets':[{'machine':'My printer','process':'My process','filament':'My PETG'}], 'models':[]}
        self.write(self.root/'data/OrcaSlicer.conf',self.config)
        self.write(self.system/'machine/Parent.json',{'type':'machine','name':'Parent','instantiation':'false','nozzle_diameter':['0.4'],'default_acceleration':'0'})
        self.write(self.account/'machine/My printer.json',{'name':'My printer','inherits':'Parent'})
        self.write(self.account/'process/My process.json',{'name':'My process','outer_wall_speed':'50%','compatible_printers':['Parent']})
        self.write(self.account/'filament/My PETG.json',{'name':'My PETG','compatible_printers':['My printer'],'printhost_apikey':'NEVER SHARE'})
        self.write(self.system/'machine/Unused.json',{'type':'machine','name':'Unused'})
        self.library=Library(self.store,self.root/'orca.exe',self.root/'data')
    def tearDown(self):self.temp.cleanup()
    def write(self,p,value):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value),encoding='utf-8')
    def test_curated_remembered_cache_and_incremental_refresh(self):
        first=self.library.refresh();self.assertEqual([p['name'] for p in first['printers']],['My printer'])
        printer=first['printers'][0];self.assertTrue(printer['current']);self.assertTrue(printer['selected']['filament'])
        self.assertNotIn('NEVER SHARE',json.dumps(first))
        self.assertEqual(next(p for p in first['profiles'] if p['type']=='machine')['default_acceleration'],'0')
        self.assertEqual(next(p for p in first['profiles'] if p['type']=='process')['outer_wall_speed'],'50%')
        with patch('discovery.stable_read',wraps=__import__('discovery').stable_read) as read:
            self.assertEqual(self.library.refresh(),first)
            self.assertEqual(read.call_count,1) # Only the small Orca configuration; no preset reparse.
        cached=Library(self.store,self.root/'orca.exe',self.root/'data')
        self.assertEqual(cached.document,first)
        self.write(self.account/'process/New saved.json',{'name':'New saved','compatible_printers':['My printer']})
        second=self.library.refresh();self.assertIn('New saved',[p['name'] for p in second['profiles']])
        snapshot=copy.deepcopy(first)
        (self.account/'process/My process.json').write_text('{incomplete')
        third=self.library.refresh();self.assertTrue(third['warnings'])
        self.assertIn('My process',[p['name'] for p in third['profiles']])
        (self.account/'process/My process.json').unlink()
        fourth=self.library.refresh();self.assertEqual(fourth['printers'][0]['selected']['process'],'')
        self.assertEqual(snapshot,first) # Earlier snapshot/experiment isn't rewritten.
    def test_explicit_compatibility_and_unknown_condition(self):
        m={'name':'User machine'}
        self.assertTrue(compatible({'compatible_printers':['Parent'],'compatible_printers_condition':'unknown'},m,'Parent'))
        self.assertFalse(compatible({'compatible_printers':['Other']},m,'Parent'))
        self.assertIsNone(compatible({'compatible_printers_condition':'unknown'},m))

if __name__=='__main__':unittest.main()
