"""The module's side of provisioning by claim, driven with simulated AWS answers (no network)."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.services import claim_flow as cf

SERIAL = "AJ-0001"
C, R = cf.csr_topics(), cf.register_topics("agripump-fleet")


def aws_accepts_csr(token="tok-123"):
    return json.dumps({"certificateOwnershipToken": token, "certificateId": "c" * 64, "certificatePem": "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----"}).encode()


class TestKeyAndCsr(unittest.TestCase):
    def test_the_key_is_made_on_the_module_and_the_csr_is_signed_by_it(self):
        key_pem, csr_pem = cf.make_key_and_csr(SERIAL)
        key = serialization.load_pem_private_key(key_pem.encode(), password=None)
        csr = x509.load_pem_x509_csr(csr_pem.encode())
        self.assertIsInstance(key, ec.EllipticCurvePrivateKey)
        self.assertTrue(csr.is_signature_valid)
        self.assertEqual(csr.subject.rfc4514_string(), f"CN={SERIAL}")
        self.assertEqual(csr.public_key().public_numbers(), key.public_key().public_numbers())

    def test_every_module_makes_its_own_key(self):
        self.assertNotEqual(cf.make_key_and_csr(SERIAL)[0], cf.make_key_and_csr(SERIAL)[0])

    def test_the_claim_connection_name_is_one_the_claim_policy_allows(self):
        self.assertEqual(cf.claim_client_id(SERIAL), "claim-AJ-0001")
        self.assertTrue(cf.claim_client_id(SERIAL).startswith("claim-"))

    def test_topics_are_the_ones_the_claim_policy_names(self):
        self.assertEqual(C["publish"], "$aws/certificates/create-from-csr/json")
        self.assertEqual(R["publish"], "$aws/provisioning-templates/agripump-fleet/provision/json")
        for topic in (C["accepted"], C["rejected"]):
            self.assertTrue(topic.startswith("$aws/certificates/create-from-csr/"))
        for topic in (R["accepted"], R["rejected"]):
            self.assertTrue(topic.startswith("$aws/provisioning-templates/agripump-fleet/provision/"))


class TestClaimFlow(unittest.TestCase):
    def test_the_happy_path_from_csr_to_a_registered_thing(self):
        flow = cf.ClaimFlow(SERIAL)
        self.assertEqual(set(flow.subscriptions()), {C["accepted"], C["rejected"], R["accepted"], R["rejected"]})
        [(topic, payload)] = flow.start()
        self.assertEqual(topic, C["publish"])
        self.assertIn("BEGIN CERTIFICATE REQUEST", json.loads(payload)["certificateSigningRequest"])
        self.assertEqual(flow.state, cf.STATE_CSR_SENT)

        [(topic, payload)] = flow.on_message(C["accepted"], aws_accepts_csr("tok-9"))
        self.assertEqual(topic, R["publish"])
        self.assertEqual(json.loads(payload), {"certificateOwnershipToken": "tok-9", "parameters": {"SerialNumber": SERIAL}})
        self.assertEqual(flow.state, cf.STATE_REGISTER_SENT)

        self.assertEqual(flow.on_message(R["accepted"], json.dumps({"thingName": SERIAL, "deviceConfiguration": {}}).encode()), [])
        self.assertEqual((flow.state, flow.thing_name, flow.done), (cf.STATE_DONE, SERIAL, True))
        self.assertIn("BEGIN EC PRIVATE KEY" if "EC PRIVATE" in flow.private_key_pem else "BEGIN PRIVATE KEY", flow.private_key_pem)
        self.assertTrue(flow.certificate_pem)

    def test_the_private_key_is_never_in_anything_sent_to_aws(self):
        flow = cf.ClaimFlow(SERIAL)
        sent = [p for _, p in flow.start()]
        sent += [p for _, p in flow.on_message(C["accepted"], aws_accepts_csr())]
        for payload in sent:
            self.assertNotIn("PRIVATE KEY", payload)

    def test_a_refused_certificate_request_stops_with_the_reason(self):
        flow = cf.ClaimFlow(SERIAL)
        flow.start()
        flow.on_message(C["rejected"], json.dumps({"errorCode": "InvalidCsr", "errorMessage": "bad"}).encode())
        self.assertEqual(flow.state, cf.STATE_FAILED)
        self.assertIn("InvalidCsr", flow.error)

    def test_a_refused_registration_stops_with_the_reason_for_example_an_unknown_serial(self):
        flow = cf.ClaimFlow(SERIAL)
        flow.start()
        flow.on_message(C["accepted"], aws_accepts_csr())
        flow.on_message(R["rejected"], json.dumps({"errorCode": "CERTIFICATE_VALIDATION_FAILURE", "errorMessage": "Pre-provisioning hook denied"}).encode())
        self.assertEqual(flow.state, cf.STATE_FAILED)
        self.assertIn("registration", flow.error)
        self.assertIn("denied", flow.error)

    def test_a_thing_named_differently_from_the_serial_is_refused(self):
        flow = cf.ClaimFlow(SERIAL)
        flow.start()
        flow.on_message(C["accepted"], aws_accepts_csr())
        flow.on_message(R["accepted"], json.dumps({"thingName": "SOMETHING-ELSE"}).encode())
        self.assertEqual(flow.state, cf.STATE_FAILED)
        self.assertIn("not 'AJ-0001'", flow.error)

    def test_garbage_and_incomplete_answers_fail_cleanly(self):
        flow = cf.ClaimFlow(SERIAL)
        flow.start()
        flow.on_message(C["accepted"], b"not json")
        self.assertEqual(flow.state, cf.STATE_FAILED)
        flow = cf.ClaimFlow(SERIAL)
        flow.start()
        flow.on_message(C["accepted"], json.dumps({"certificatePem": "x"}).encode())      # no token
        self.assertEqual(flow.state, cf.STATE_FAILED)

    def test_late_or_out_of_order_answers_change_nothing(self):
        flow = cf.ClaimFlow(SERIAL)
        flow.start()
        self.assertEqual(flow.on_message(R["accepted"], json.dumps({"thingName": SERIAL}).encode()), [], "register answer before a certificate")
        self.assertEqual(flow.state, cf.STATE_CSR_SENT)
        flow.on_message(C["accepted"], aws_accepts_csr())
        flow.on_message(R["accepted"], json.dumps({"thingName": SERIAL}).encode())
        done = (flow.state, flow.thing_name)
        self.assertEqual(flow.on_message(C["accepted"], aws_accepts_csr("other")), [])
        self.assertEqual((flow.state, flow.thing_name), done)


if __name__ == "__main__":
    unittest.main()
