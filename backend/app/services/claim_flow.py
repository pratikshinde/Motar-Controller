"""The device side of fleet provisioning by claim: what a starter's module does on its first power-up, as a small state machine.

A module that holds only the shared claim certificate connects as `claim-<serial>` and, over MQTT:

    1. makes its own private key and a certificate signing request (CSR), and publishes the CSR to  $aws/certificates/create-from-csr/json
       -> AWS answers  .../accepted  with a certificate and an ownership token (or .../rejected)
    2. publishes the token and its serial to  $aws/provisioning-templates/<template>/provision/json
       -> AWS asks the backend (through the Lambda) whether that serial is on the factory list and unused, then creates the thing
       -> AWS answers  .../accepted  with the thing name (or .../rejected)
    3. keeps the certificate and its own private key, reconnects as the thing, and never uses the claim certificate again.

The private key is made on the module and never leaves it. This file has no network code, so the same steps are tested without AWS and followed by
`simulator/claim_device.py` (a stand-in for the module) and by the firmware.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

Publish = Tuple[str, str]       # (topic, JSON payload)

STATE_START, STATE_CSR_SENT, STATE_REGISTER_SENT, STATE_DONE, STATE_FAILED = "start", "csr-sent", "register-sent", "done", "failed"


def csr_topics() -> dict:
    base = "$aws/certificates/create-from-csr/json"
    return {"publish": base, "accepted": f"{base}/accepted", "rejected": f"{base}/rejected"}


def register_topics(template: str) -> dict:
    base = f"$aws/provisioning-templates/{template}/provision/json"
    return {"publish": base, "accepted": f"{base}/accepted", "rejected": f"{base}/rejected"}


def claim_client_id(serial: str) -> str:
    """The claim policy only lets a connection named claim-* in."""
    return f"claim-{serial}"


def make_key_and_csr(serial: str) -> Tuple[str, str]:
    """A fresh private key (kept on the module) and the CSR that asks AWS for a certificate for it. Returns (private key PEM, CSR PEM)."""
    key = ec.generate_private_key(ec.SECP256R1())
    csr = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, serial)]))
        .sign(key, hashes.SHA256())
    )
    key_pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    return key_pem, csr.public_bytes(serialization.Encoding.PEM).decode()


@dataclass
class ClaimFlow:
    serial: str
    template: str = "agripump-fleet"
    state: str = STATE_START
    private_key_pem: str = ""
    certificate_pem: str = ""
    certificate_id: str = ""
    thing_name: str = ""
    error: str = ""
    _token: str = field(default="", repr=False)

    def subscriptions(self) -> List[str]:
        """Everything to subscribe to before the first publish, or an answer can be missed."""
        c, r = csr_topics(), register_topics(self.template)
        return [c["accepted"], c["rejected"], r["accepted"], r["rejected"]]

    def start(self) -> List[Publish]:
        """Step 1: make the key and the CSR and ask for a certificate."""
        self.private_key_pem, csr_pem = make_key_and_csr(self.serial)
        self.state = STATE_CSR_SENT
        return [(csr_topics()["publish"], json.dumps({"certificateSigningRequest": csr_pem}))]

    def on_message(self, topic: str, payload: bytes) -> List[Publish]:
        """AWS answered. Returns what to publish next (nothing when finished or failed)."""
        if self.state in (STATE_DONE, STATE_FAILED):
            return []
        try:
            body = json.loads(payload)
        except (ValueError, TypeError):
            return self._fail("AWS sent an answer that is not JSON")
        c, r = csr_topics(), register_topics(self.template)

        if topic in (c["rejected"], r["rejected"]):
            what = "the certificate request" if topic == c["rejected"] else "the registration"
            return self._fail(f"AWS refused {what}: {body.get('errorCode', '?')} {body.get('errorMessage', '')}".strip())

        if topic == c["accepted"] and self.state == STATE_CSR_SENT:
            token, pem = body.get("certificateOwnershipToken"), body.get("certificatePem")
            if not token or not pem:
                return self._fail("AWS accepted the certificate request but sent no certificate")
            self._token, self.certificate_pem, self.certificate_id = token, pem, str(body.get("certificateId", ""))
            self.state = STATE_REGISTER_SENT
            return [(r["publish"], json.dumps({"certificateOwnershipToken": token, "parameters": {"SerialNumber": self.serial}}))]

        if topic == r["accepted"] and self.state == STATE_REGISTER_SENT:
            thing = body.get("thingName")
            if not thing:
                return self._fail("AWS accepted the registration but sent no thing name")
            if thing != self.serial:
                # The thing name, the MQTT client id and the pump id are one string; a different name would make every later frame unmatched.
                return self._fail(f"AWS named the thing '{thing}', not '{self.serial}'")
            self.thing_name = thing
            self.state = STATE_DONE
            return []
        return []

    def _fail(self, message: str) -> List[Publish]:
        self.state, self.error = STATE_FAILED, message
        return []

    @property
    def done(self) -> bool:
        return self.state in (STATE_DONE, STATE_FAILED)
