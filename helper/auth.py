"""Browser public-key trust. Persistent private browser keys never cross the API."""
import base64
import hmac
import secrets
import threading
import time
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, utils


def decode(value):
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError('Invalid public-key proof')
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))


class Trust:
    def __init__(self, store):
        self.store = store
        self.clients = dict(store.data.get('trusted', {}))
        self.revoked = dict(store.data.get('revoked', {}))
        self.approvals = {}
        self.approval_pending = ''
        self.sessions = {}
        self.challenges = {}
        self.lock = threading.RLock()
        self.code = ''
        self.code_until = 0
        self.failures = []
        self.last_connected = 0

    def pairing_code(self):
        with self.lock:
            if time.time() >= self.code_until:
                self.code = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(8))
                self.code_until = time.time() + 300
            return self.code

    def challenge(self, origin, client):
        with self.lock:
            if not isinstance(client, str) or not 16 <= len(client) <= 80:
                raise ValueError('Invalid browser identity')
            now = time.time()
            self.challenges = {k:v for k,v in self.challenges.items() if v['until'] > now}
            if len(self.challenges) >= 64:
                raise ValueError('Too many pairing attempts; retry shortly')
            ident = secrets.token_urlsafe(24)
            message = f'Speed Printer trust v1\n{origin}\n{client}\n{ident}'
            self.challenges[ident] = {'client':client, 'origin':origin, 'message':message, 'until':now+30}
            record=self.clients.get(client)
            return {'id':ident, 'message':message, 'paired':bool(record and record['origin']==origin), 'revoked':self.revoked.get(client)==origin}

    def authenticate(self, origin, body, pairing=False, approve=None):
        with self.lock:
            now = time.time()
            self.failures = [t for t in self.failures if now-t < 60]
            if len(self.failures) >= 10:
                raise ValueError('Too many failed proofs; wait one minute')
            try:
                challenge = self.challenges.pop(body.get('challenge', ''), None)
                client = body.get('clientId')
                if not challenge or challenge['until'] <= now or challenge['origin'] != origin or challenge['client'] != client:
                    raise ValueError('Expired or invalid browser challenge')
                if pairing or approve:
                    if not approve and (now >= self.code_until or not self.code or not hmac.compare_digest(str(body.get('code','')).strip().upper(), self.code)):
                        raise ValueError('Copy a current pairing code from the helper tray')
                    jwk = body['publicKey']
                else:
                    record = self.clients.get(client)
                    if not record or record['origin'] != origin:
                        raise ValueError('Browser is not paired or pairing was revoked')
                    jwk = record['publicKey']
                if not isinstance(jwk, dict) or jwk.get('kty') != 'EC' or jwk.get('crv') != 'P-256' or 'd' in jwk:
                    raise ValueError('Expected a P-256 public key only')
                public = ec.EllipticCurvePublicNumbers(int.from_bytes(decode(jwk['x']),'big'), int.from_bytes(decode(jwk['y']),'big'),ec.SECP256R1()).public_key()
                signature = decode(body['signature'])
                if len(signature) != 64:
                    raise ValueError('Invalid signature size')
                der = utils.encode_dss_signature(int.from_bytes(signature[:32],'big'),int.from_bytes(signature[32:],'big'))
                public.verify(der, challenge['message'].encode(), ec.ECDSA(hashes.SHA256()))
                if approve:
                    if client in self.clients or self.revoked.get(client)==origin:
                        raise ValueError('Use existing trust or explicitly pair again after revocation')
                    # Verify key possession BEFORE prompting. Bound local prompts
                    # even if an allowed origin generates many browser identities.
                    recent=[t for t in self.approvals.values() if now-t<60]
                    if len(recent)>=3 or now-self.approvals.get(client,0)<60:
                        raise ValueError('Approval already requested; retry later')
                    self.approvals={k:v for k,v in self.approvals.items() if now-v<60}
                    self.approvals[client]=now
                    self.approval_pending=origin
                    try:
                        if not approve(origin): raise ValueError('Local approval declined')
                    finally:self.approval_pending=''
                    now=time.time()
                if pairing or approve:
                    clean = {k:jwk[k] for k in ('kty','crv','x','y')}
                    self.clients[client] = {'origin':origin, 'publicKey':clean, 'pairedAt':now}
                    self.revoked.pop(client,None)
                    self.store.update(trusted=self.clients,revoked=self.revoked)
                    self.code = ''; self.code_until = 0
                token = secrets.token_urlsafe(32)
                # Several tabs can share one browser identity without revoking each other.
                self.sessions = {k:v for k,v in self.sessions.items() if v['until'] > now}
                own = [k for k,v in self.sessions.items() if v['client'] == client]
                for old in own[:-7]: self.sessions.pop(old,None)
                self.sessions[token] = {'client':client, 'origin':origin, 'until':now+8*3600}
                self.last_connected = now
                return {'token':token}
            except (ValueError, KeyError, TypeError, InvalidSignature):
                self.failures.append(now)
                raise ValueError('Connection not approved, revoked, or proof expired. Retry approval in Settings or use a fresh fallback code.') from None

    def permitted(self, origin, header):
        with self.lock:
            token = header.removeprefix('Bearer ')
            record = self.sessions.get(token)
            if record and record['origin'] == origin and record['until'] > time.time() and record['client'] in self.clients:
                self.last_connected = time.time()
                return True
            return False

    def revoke(self, header=None):
        with self.lock:
            if header:
                record = self.sessions.get(header.removeprefix('Bearer '))
                if record:
                    self.revoked[record['client']]=record['origin']
                    self.clients.pop(record['client'],None)
            else:
                self.revoked.update({k:v['origin'] for k,v in self.clients.items()})
                self.clients.clear()
            self.sessions = {k:v for k,v in self.sessions.items() if v['client'] in self.clients}
            self.store.update(trusted=self.clients,revoked=self.revoked)
            self.code = ''; self.code_until = 0
