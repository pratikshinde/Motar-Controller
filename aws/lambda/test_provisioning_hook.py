"""Tests for the pre-provisioning hook. No AWS and no backend needed:  python -m unittest aws/lambda/test_provisioning_hook.py"""
import io
import json
import os
import sys
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import provisioning_hook as hook  # noqa: E402

SERIAL = "0123456789ABCDEF01234567"
EVENT = {
    "claimCertificateId": "claim-1",
    "certificateId": "cert-1",
    "certificatePem": "-----BEGIN CERTIFICATE-----",  # must not be forwarded
    "templateArn": "arn:aws:iot:ap-south-1:111122223333:provisioningtemplate/agripump-fleet",
    "clientId": "claim-abc",
    "parameters": {"SerialNumber": SERIAL},
}
ENV = {"BACKEND_HOOK_URL": "https://backend.example/api/v1/batches/provisioning/pre-hook", "HOOK_SECRET": "s3cret"}


def _response(payload):
    return io.BytesIO(json.dumps(payload).encode())


class ProvisioningHookTests(unittest.TestCase):
    def call(self, event=EVENT, *, backend=None, env=ENV, raises=None):
        """Runs the handler with the backend replaced; returns (result, the request that was sent or None)."""
        sent = []

        def fake_urlopen(request, timeout):
            sent.append(request)
            if raises:
                raise raises
            return _response(backend)

        with mock.patch.dict(os.environ, env, clear=True), mock.patch("urllib.request.urlopen", fake_urlopen):
            return hook.lambda_handler(event, None), (sent[0] if sent else None)

    def test_an_allow_is_relayed_and_the_secret_and_a_trimmed_request_are_sent(self):
        result, request = self.call(backend={
            "allowProvisioning": True,
            "parameterOverrides": {"ThingName": SERIAL, "ThingGroupName": "production"},
        })
        self.assertEqual(result, {
            "allowProvisioning": True,
            "parameterOverrides": {"ThingName": SERIAL, "ThingGroupName": "production"},
        })
        self.assertEqual(request.get_header("X-hook-secret"), "s3cret")
        body = json.loads(request.data)
        self.assertEqual(body["parameters"], {"SerialNumber": SERIAL})
        self.assertNotIn("certificatePem", body)

    def test_a_refusal_is_relayed_without_overrides(self):
        result, _ = self.call(backend={"allowProvisioning": False, "error": "already been claimed", "parameterOverrides": {}})
        self.assertEqual(result, {"allowProvisioning": False})

    def test_a_thing_name_that_is_not_the_presented_serial_is_refused(self):
        result, _ = self.call(backend={"allowProvisioning": True, "parameterOverrides": {"ThingName": "PUMP-" + SERIAL}})
        self.assertEqual(result, {"allowProvisioning": False})

    def test_anything_but_a_clear_true_is_a_refusal(self):
        for verdict in ({}, {"allowProvisioning": "true"}, {"allowProvisioning": 1}, {"allowProvisioning": None}):
            result, _ = self.call(backend={**verdict, "parameterOverrides": {"ThingName": SERIAL}})
            self.assertEqual(result, {"allowProvisioning": False}, verdict)

    def test_it_fails_closed_when_the_backend_cannot_be_used(self):
        errors = (
            urllib.error.HTTPError("u", 401, "bad secret", {}, None),
            urllib.error.URLError("unreachable"),
            TimeoutError(),
            json.JSONDecodeError("x", "y", 0),
        )
        for error in errors:
            result, _ = self.call(raises=error)
            self.assertEqual(result, {"allowProvisioning": False}, repr(error))

    def test_it_fails_closed_when_it_is_not_configured(self):
        result, request = self.call(backend={"allowProvisioning": True}, env={})
        self.assertEqual(result, {"allowProvisioning": False})
        self.assertIsNone(request)

    def test_a_request_without_a_serial_never_reaches_the_backend(self):
        for event in ({}, {"parameters": {}}, {"parameters": {"SerialNumber": "  "}}, None):
            result, request = self.call(event, backend={"allowProvisioning": True})
            self.assertEqual(result, {"allowProvisioning": False}, event)
            self.assertIsNone(request)


if __name__ == "__main__":
    unittest.main()
