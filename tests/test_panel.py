import concurrent.futures
import hashlib
import json
import tempfile
import time
import unittest
from pathlib import Path

from werkzeug.security import generate_password_hash
from vaio.server import create_app, agent_archive


class PanelTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app({"TESTING": True, "DATABASE": self.tmp.name + "/panel.sqlite"})
        self.store = self.app.extensions["store"]
        with self.store.connect() as db:
            db.execute("INSERT INTO settings VALUES('password',?)", (generate_password_hash("a-long-test-password", method="pbkdf2:sha256:1000"),))
        self.client = self.app.test_client()
        response = self.client.post('/api/login', json={"password": "a-long-test-password"})
        self.csrf = response.json['csrf']
        self.headers = {"X-CSRF-Token": self.csrf}

    def tearDown(self):
        self.tmp.cleanup()

    def add(self):
        result = self.client.post('/api/nodes', json={"name": "test node"}, headers=self.headers)
        self.assertEqual(result.status_code, 201)
        script = result.json['script']
        enrollment = json.loads(script.split("<<'VAIO_ENROLLMENT'\n")[1].split('\nVAIO_ENROLLMENT')[0])
        return result.json['node_id'], enrollment

    def registered(self):
        node, enrollment = self.add()
        result = self.client.post('/api/enroll', json=enrollment)
        self.assertEqual(result.status_code, 200)
        token = {"Authorization": "Bearer " + result.json['token']}
        snap = {"revision": "a"*64, "instances": [], "metrics": {"load": 1}, "private_key": "NO_LEAK"}
        self.client.post('/api/agent/'+node+'/poll', json={"snapshot":snap,"ready":True}, headers=token)
        self.client.post('/api/nodes/'+node+'/adopt', json={"revision":"a"*64}, headers=self.headers)
        return node, token, snap

    def task(self, node, key='task1'):
        return self.client.post('/api/nodes/'+node+'/tasks', headers={**self.headers,"Idempotency-Key":key},
                                json={"action":"install","protocol":"vless","core":"xray","port":24443,"params":{"sni":"example.com"},"revision":"a"*64})

    def test_auth_csrf_cookie_and_no_login_csrf(self):
        client = self.app.test_client()
        self.assertEqual(client.get('/api/nodes').status_code,401)
        self.assertEqual(self.client.post('/api/nodes',json={"name":"bad"}).status_code,403)
        self.assertEqual(client.post('/api/login',json={"password":"a-long-test-password"},headers={"Origin":"https://evil.test"}).status_code,403)
        response = client.post('/api/login',json={"password":"a-long-test-password"})
        self.assertIn('HttpOnly',response.headers['Set-Cookie'])
        self.assertIn('SameSite=Strict',response.headers['Set-Cookie'])

    def test_enrollment_single_use_and_expiration(self):
        node, enrollment = self.add()
        self.assertEqual(self.client.post('/api/enroll',json=enrollment).status_code,200)
        self.assertEqual(self.client.post('/api/enroll',json=enrollment).status_code,401)
        node2, expired = self.add()
        with self.store.connect() as db:
            db.execute('UPDATE nodes SET enroll_expires=? WHERE id=?',(time.time()-1,node2))
        self.assertEqual(self.client.post('/api/enroll',json=expired).status_code,401)

    def test_parallel_enrollment_consumes_once(self):
        node, enrollment = self.add()
        def enroll():
            return self.app.test_client().post('/api/enroll',json=enrollment).status_code
        with concurrent.futures.ThreadPoolExecutor(2) as executor:
            self.assertEqual(sorted(executor.map(lambda _:enroll(),range(2))),[200,401])

    def test_task_idempotency_claim_once_result_ownership(self):
        node, token, snap = self.registered()
        first=self.task(node)
        self.assertEqual(first.status_code,201)
        self.assertEqual(self.task(node).json['id'],first.json['id'])
        self.assertEqual(self.task(node,'different').status_code,409)
        poll=lambda:self.client.post('/api/agent/'+node+'/poll',json={"snapshot":snap,"ready":True},headers=token).json
        self.assertEqual(poll()['task']['id'],first.json['id'])
        self.assertIsNone(poll()['task'])
        node2, token2, _ = self.registered()
        self.assertEqual(self.client.post('/api/agent/'+node2+'/tasks/'+first.json['id']+'/result',headers=token2,json={"status":"succeeded","message":"ok"}).status_code,404)
        for _ in range(2):
            self.assertEqual(self.client.post('/api/agent/'+node+'/tasks/'+first.json['id']+'/result',headers=token,json={"status":"succeeded","message":"ok","result":{"private_key":"DROP","steps":["done"]}}).status_code,200)
        result=self.client.get('/api/tasks').json['tasks'][0]
        self.assertEqual(result['result'],{'steps':['done']})

    def test_revoke_cancels_queue_and_rejects_identity(self):
        node, token, snap=self.registered()
        self.task(node)
        self.client.post('/api/nodes/'+node+'/revoke',headers=self.headers)
        self.assertEqual(self.client.post('/api/agent/'+node+'/poll',headers=token,json={"snapshot":snap}).status_code,401)
        self.assertEqual(self.client.get('/api/tasks').json['tasks'][0]['status'],'cancelled')

    def test_state_and_capability_validation(self):
        node,token,snap=self.registered()
        with self.store.connect() as db:
            db.execute('UPDATE nodes SET adopted=0 WHERE id=?',(node,))
        self.assertEqual(self.task(node).status_code,409)
        response=self.client.post('/api/nodes/'+node+'/tasks',headers={**self.headers,'Idempotency-Key':'bad'},json={"action":"shell","command":"id"})
        self.assertEqual(response.status_code,400)
        self.assertNotIn('NO_LEAK',self.client.get('/api/nodes').text)

    def test_timeout_is_unknown_never_requeued(self):
        node,token,snap=self.registered()
        self.task(node)
        self.client.post('/api/agent/'+node+'/poll',headers=token,json={"snapshot":snap,"ready":True})
        with self.store.connect() as db:
            db.execute('UPDATE tasks SET started=?',(time.time()-2200,))
        self.assertEqual(self.client.get('/api/tasks').json['tasks'][0]['status'],'unknown')
        self.assertIsNone(self.client.post('/api/agent/'+node+'/poll',headers=token,json={"snapshot":snap,"ready":True}).json['task'])

    def test_login_rate_limit(self):
        client=self.app.test_client()
        for _ in range(8):
            self.assertEqual(client.post('/api/login',json={"password":"bad"}).status_code,401)
        self.assertEqual(client.post('/api/login',json={"password":"bad"}).status_code,429)

    def test_agent_bundle_deterministic_and_checksum(self):
        one=agent_archive()
        time.sleep(1.01)
        self.assertEqual(one,agent_archive())
        payload=self.client.get('/downloads/agent.tar.gz').data
        checksum=self.client.get('/downloads/agent.sha256').text.split()[0]
        self.assertEqual(hashlib.sha256(payload).hexdigest(),checksum)

    def test_public_url_requires_tls(self):
        with self.assertRaises(ValueError):
            create_app({"DATABASE":self.tmp.name+'/invalid.sqlite',"PUBLIC_URL":"http://public.example.com"})


if __name__=='__main__':
    unittest.main()
