import argparse
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import threading
import unittest
from server import State, LocalServer, handler_for, moon_read

class SecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.state=State(argparse.Namespace(orca='missing',origin=['http://127.0.0.1:5173']))
        cls.server=LocalServer(('127.0.0.1',0),handler_for(cls.state))
        threading.Thread(target=cls.server.serve_forever,daemon=True).start()
    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close();cls.state.pool.shutdown()
    def request(self,origin='http://127.0.0.1:5173',token=None,host='127.0.0.1:8377',method='GET'):
        conn=HTTPConnection('127.0.0.1',self.server.server_port)
        conn.request(method,'/health',headers={'Host':host,'Origin':origin,'Authorization':'Bearer '+(token or self.state.token)})
        r=conn.getresponse();status=r.status;r.read();conn.close();return status
    def test_auth_host_origin(self):
        self.assertEqual(self.request(),200)
        self.assertEqual(self.request(token='wrong'),403)
        self.assertEqual(self.request(origin='https://evil.example'),403)
        self.assertEqual(self.request(host='evil.example:8377'),403)
        self.assertEqual(self.request(origin='null'),403)
    def test_preflight_restricts_origins(self):
        self.assertEqual(self.request(method='OPTIONS'),204)
        self.assertEqual(self.request(method='OPTIONS',origin='https://evil.example'),403)
    def test_only_one_helper_can_own_a_port(self):
        with self.assertRaises(OSError):
            duplicate=LocalServer(self.server.server_address,handler_for(self.state))
            duplicate.server_close()
    def test_moonraker_cannot_proxy_arbitrary_routes(self):
        with self.assertRaises(ValueError):moon_read('http://127.0.0.1:8377','/server/history/list?limit=100&order=desc')
        with self.assertRaises(ValueError):moon_read('http://169.254.169.254','/server/history/list?limit=100&order=desc')
        with self.assertRaises(ValueError):moon_read('http://user:password@192.168.1.2','/printer/gcode/script')

if __name__=='__main__':unittest.main()
