"""Factory provisioning of AWS IoT identities, tested against a fake AWS client (nothing touches AWS)."""
import csv
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from botocore.exceptions import ClientError

from app.services.device_provisioning import (
    CREATED, EXISTS, FAILED, INVALID, NO_CERTIFICATE, NOT_FOUND, REVOKED, WOULD_CREATE, WOULD_REVOKE,
    FactoryProvisioner, ProvisioningError, parse_ids,
)

POLICY = "agripump-device-policy"
ROOT_CA = b"-----BEGIN CERTIFICATE-----\nROOT\n-----END CERTIFICATE-----\n"


def client_error(code, op):
    return ClientError({"Error": {"Code": code, "Message": code}}, op)


class FakeIot:
    """Just enough of boto3's IoT client: it remembers what exists and can be told to fail at one step."""

    def __init__(self, policy_exists=True, existing_things=(), fail_at=None):
        self.policy_exists = policy_exists
        self.things = set(existing_things)
        self.certs = {}            # certificateId -> status
        self.principals = {}       # thing -> [certificateArn]
        self.policies = {}         # certificateArn -> [policy names]
        self.fail_at = fail_at
        self.calls = []
        self.n = 0

    def _maybe_fail(self, op):
        if self.fail_at == op:
            raise client_error("InternalFailure", op)

    def get_policy(self, policyName):
        self.calls.append("get_policy")
        if not self.policy_exists:
            raise client_error("ResourceNotFoundException", "GetPolicy")
        return {"policyName": policyName}

    def describe_thing(self, thingName):
        self.calls.append("describe_thing")
        if thingName not in self.things:
            raise client_error("ResourceNotFoundException", "DescribeThing")
        return {"thingName": thingName}

    def create_thing(self, thingName):
        self.calls.append("create_thing")
        self._maybe_fail("create_thing")
        self.things.add(thingName)

    def create_keys_and_certificate(self, setAsActive):
        self.calls.append("create_keys_and_certificate")
        self._maybe_fail("create_keys_and_certificate")
        self.n += 1
        cid = f"{self.n:064x}"
        self.certs[cid] = "ACTIVE" if setAsActive else "INACTIVE"
        return {
            "certificateArn": f"arn:aws:iot:ap-south-1:111122223333:cert/{cid}", "certificateId": cid,
            "certificatePem": "CERT-PEM", "keyPair": {"PrivateKey": "PRIVATE-KEY-PEM", "PublicKey": "PUBLIC-KEY-PEM"},
        }

    def attach_policy(self, policyName, target):
        self.calls.append("attach_policy")
        self._maybe_fail("attach_policy")
        self.policies.setdefault(target, []).append(policyName)

    def attach_thing_principal(self, thingName, principal):
        self.calls.append("attach_thing_principal")
        self._maybe_fail("attach_thing_principal")
        self.principals.setdefault(thingName, []).append(principal)

    def detach_thing_principal(self, thingName, principal):
        self.calls.append("detach_thing_principal")
        if principal in self.principals.get(thingName, []):
            self.principals[thingName].remove(principal)

    def detach_policy(self, policyName, target):
        self.calls.append("detach_policy")
        self.policies.pop(target, None)

    def update_certificate(self, certificateId, newStatus):
        self.calls.append("update_certificate")
        self.certs[certificateId] = newStatus

    def delete_certificate(self, certificateId, forceDelete=False):
        self.calls.append("delete_certificate")
        self.certs.pop(certificateId, None)

    def delete_thing(self, thingName):
        self.calls.append("delete_thing")
        self.things.discard(thingName)

    def list_thing_principals(self, thingName):
        self.calls.append("list_thing_principals")
        if thingName not in self.things:
            raise client_error("ResourceNotFoundException", "ListThingPrincipals")
        return {"principals": list(self.principals.get(thingName, []))}


class TestParseIds(unittest.TestCase):
    def test_reads_lists_in_the_shapes_a_factory_has_them(self):
        ids, refused = parse_ids("AJ-0001\nAJ-0002\tAJ-9999 (a CSV row: only the first column is the ID)\n\n# a comment\nAJ-0003 AJ-0004 AJ-0005  # trailing\n")
        self.assertEqual(ids, ["AJ-0001", "AJ-0002", "AJ-0003", "AJ-0004", "AJ-0005"])
        self.assertEqual(refused, [])

    def test_skips_a_header_and_takes_the_first_cell_of_a_csv_row(self):
        ids, _ = parse_ids("starter_id,imei,batch\nAJ-0001,861234567890123,B1\nAJ-0002,861234567890124,B1\n")
        self.assertEqual(ids, ["AJ-0001", "AJ-0002"])

    def test_drops_duplicates_and_refuses_ids_aws_or_the_backend_would_not_accept(self):
        ids, refused = parse_ids("AJ-1\nAJ-1\nbad id!\nAJ/2\n" + "X" * 51 + "\nAJ_3:ok\n")
        self.assertEqual(ids, ["AJ-1", "AJ_3:ok"])
        self.assertEqual(len(refused), 3, "'bad id!' is one bad ID, not two")


class TestProvision(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = os.path.join(self.tmp.name, "out")
        self.addCleanup(self.tmp.cleanup)

    def tool(self, iot, apply):
        return FactoryProvisioner(iot, POLICY, self.out, root_ca_pem=ROOT_CA, apply=apply,
                                  now=lambda: datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc))

    def test_a_dry_run_creates_nothing_anywhere(self):
        iot = FakeIot()
        results = self.tool(iot, apply=False).provision(["AJ-1", "AJ-2"])
        self.assertEqual([r.status for r in results], [WOULD_CREATE, WOULD_CREATE])
        self.assertEqual(iot.things, set())
        self.assertEqual(iot.certs, {})
        self.assertFalse(os.path.exists(os.path.join(self.out, "AJ-1")))
        self.assertNotIn("create_thing", iot.calls)
        self.assertNotIn("create_keys_and_certificate", iot.calls)

    def test_apply_creates_the_thing_the_certificate_the_attachments_and_the_files(self):
        iot = FakeIot()
        [r] = self.tool(iot, apply=True).provision(["AJ-1"])
        self.assertEqual(r.status, CREATED)
        self.assertIn("AJ-1", iot.things)
        cid = r.certificate_id
        self.assertEqual(iot.certs[cid], "ACTIVE")
        self.assertEqual(iot.policies[r.certificate_arn], [POLICY])
        self.assertEqual(iot.principals["AJ-1"], [r.certificate_arn], "the device policy requires the thing to be attached to the certificate")
        folder = os.path.join(self.out, "AJ-1")
        self.assertEqual(
            sorted(os.listdir(folder)),
            sorted([f"{cid}-certificate.pem.crt", f"{cid}-private.pem.key", f"{cid}-public.pem.key", "AmazonRootCA1.pem"]),
        )
        self.assertEqual(open(os.path.join(folder, f"{cid}-private.pem.key")).read(), "PRIVATE-KEY-PEM")
        self.assertEqual(open(os.path.join(folder, "AmazonRootCA1.pem"), "rb").read(), ROOT_CA)

    def test_every_starter_gets_its_own_certificate(self):
        iot = FakeIot()
        a, b = self.tool(iot, apply=True).provision(["AJ-1", "AJ-2"])
        self.assertNotEqual(a.certificate_id, b.certificate_id)
        self.assertEqual(len(iot.certs), 2)

    def test_a_thing_that_already_exists_is_left_alone(self):
        iot = FakeIot(existing_things=["AJ-1"])
        [r] = self.tool(iot, apply=True).provision(["AJ-1"])
        self.assertEqual(r.status, EXISTS)
        self.assertNotIn("create_keys_and_certificate", iot.calls)
        self.assertFalse(os.path.exists(os.path.join(self.out, "AJ-1")))

    def test_rerunning_after_a_success_creates_nothing_more(self):
        iot = FakeIot()
        self.tool(iot, apply=True).provision(["AJ-1"])
        before = len(iot.certs)
        [r] = self.tool(iot, apply=True).provision(["AJ-1"])
        self.assertEqual(r.status, EXISTS)
        self.assertEqual(len(iot.certs), before)

    def test_a_folder_that_already_has_files_is_never_overwritten(self):
        os.makedirs(os.path.join(self.out, "AJ-1"))
        with open(os.path.join(self.out, "AJ-1", "old-private.pem.key"), "w") as fh:
            fh.write("THE ONLY COPY")
        iot = FakeIot()
        [r] = self.tool(iot, apply=True).provision(["AJ-1"])
        self.assertEqual(r.status, FAILED)
        self.assertIn("never overwritten", r.detail)
        self.assertEqual(iot.things, set(), "nothing was created in AWS either")
        self.assertEqual(open(os.path.join(self.out, "AJ-1", "old-private.pem.key")).read(), "THE ONLY COPY")

    def test_when_a_step_fails_everything_made_for_that_starter_is_removed_and_the_others_still_run(self):
        class FailsForOne(FakeIot):
            def attach_thing_principal(self, thingName, principal):
                if thingName == "AJ-BAD":
                    raise client_error("InternalFailure", "AttachThingPrincipal")
                return super().attach_thing_principal(thingName, principal)

        iot = FailsForOne()
        bad, good = self.tool(iot, apply=True).provision(["AJ-BAD", "AJ-GOOD"])
        self.assertEqual(bad.status, FAILED)
        self.assertIn("removed", bad.detail)
        self.assertNotIn("AJ-BAD", iot.things)
        self.assertEqual(len(iot.certs), 1, "only the good starter's certificate is left")
        self.assertFalse(os.path.exists(os.path.join(self.out, "AJ-BAD")))
        self.assertEqual(good.status, CREATED)
        self.assertTrue(os.path.isdir(os.path.join(self.out, "AJ-GOOD")))

    def test_failing_to_make_the_certificate_removes_the_thing(self):
        iot = FakeIot(fail_at="create_keys_and_certificate")
        [r] = self.tool(iot, apply=True).provision(["AJ-1"])
        self.assertEqual(r.status, FAILED)
        self.assertEqual(iot.things, set())

    def test_an_invalid_id_is_refused_without_calling_aws(self):
        iot = FakeIot()
        [r] = self.tool(iot, apply=True).provision(["not valid!"])
        self.assertEqual(r.status, INVALID)
        self.assertEqual(iot.calls, [])

    def test_a_missing_device_policy_stops_the_whole_run(self):
        with self.assertRaises(ProvisioningError) as ctx:
            self.tool(FakeIot(policy_exists=False), apply=True).check_policy()
        self.assertIn("aws/policies/device-policy.json", str(ctx.exception))
        self.tool(FakeIot(), apply=True).check_policy()      # present: fine

    def test_the_manifest_lists_what_happened_and_holds_no_key(self):
        iot = FakeIot()
        tool = self.tool(iot, apply=True)
        results = tool.provision(["AJ-1", "AJ-2"])
        path = tool.write_manifest(results)
        self.assertTrue(path.endswith("manifest-provision-20261111-120000.csv"))
        text = open(path, encoding="utf-8").read()
        self.assertNotIn("PRIVATE-KEY-PEM", text)
        self.assertNotIn("CERT-PEM", text)
        rows = list(csv.DictReader(open(path, encoding="utf-8")))
        self.assertEqual([(r["starter_id"], r["status"]) for r in rows], [("AJ-1", CREATED), ("AJ-2", CREATED)])
        self.assertTrue(all(r["certificate_arn"].startswith("arn:aws:iot:") for r in rows))

    def test_a_dry_run_manifest_is_marked_as_one(self):
        tool = self.tool(FakeIot(), apply=False)
        path = tool.write_manifest(tool.provision(["AJ-1"]))
        self.assertTrue(path.endswith("-dryrun.csv"))


class TestRevoke(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.iot = FakeIot()
        FactoryProvisioner(self.iot, POLICY, self.tmp.name, apply=True).provision(["AJ-1"])
        self.cid = next(iter(self.iot.certs))

    def test_a_dry_run_changes_nothing(self):
        [r] = FactoryProvisioner(self.iot, POLICY, self.tmp.name, apply=False).revoke(["AJ-1"])
        self.assertEqual(r.status, WOULD_REVOKE)
        self.assertEqual(self.iot.certs[self.cid], "ACTIVE")

    def test_apply_switches_the_certificate_off_and_detaches_it_but_deletes_nothing(self):
        [r] = FactoryProvisioner(self.iot, POLICY, self.tmp.name, apply=True).revoke(["AJ-1"])
        self.assertEqual(r.status, REVOKED)
        self.assertEqual(self.iot.certs[self.cid], "INACTIVE")
        self.assertEqual(self.iot.principals["AJ-1"], [])
        self.assertIn("AJ-1", self.iot.things)
        self.assertNotIn("delete_certificate", self.iot.calls[-5:])

    def test_unknown_things_and_things_without_a_certificate_are_reported(self):
        tool = FactoryProvisioner(self.iot, POLICY, self.tmp.name, apply=True)
        self.assertEqual(tool.revoke(["AJ-NOPE"])[0].status, NOT_FOUND)
        tool.revoke(["AJ-1"])
        self.assertEqual(tool.revoke(["AJ-1"])[0].status, NO_CERTIFICATE)


if __name__ == "__main__":
    unittest.main()
