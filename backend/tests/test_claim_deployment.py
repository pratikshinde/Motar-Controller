"""The one-time AWS setup for provisioning by claim, tested against fake AWS clients (nothing touches AWS)."""
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from botocore.exceptions import ClientError

from app.services import claim_deployment as cd

AWS_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "aws"))
URL = "https://api.example.com/api/v1/batches/provisioning/pre-hook"
SECRET = "s" * 40
ACCOUNT = "111122223333"


def err(code, op, message=None):
    return ClientError({"Error": {"Code": code, "Message": message or code}}, op)


class FakeIot:
    def __init__(self):
        self.policies, self.groups, self.templates, self.certs = {}, set(), {}, {}
        self.attached = []
        self.calls = []

    def get_policy(self, policyName):
        if policyName not in self.policies:
            raise err("ResourceNotFoundException", "GetPolicy")
        return {"policyDocument": self.policies[policyName]}

    def create_policy(self, policyName, policyDocument):
        self.calls.append(("create_policy", policyName))
        self.policies[policyName] = policyDocument

    def list_policy_versions(self, policyName):
        return {"policyVersions": [{"versionId": "1", "isDefaultVersion": True}]}

    def create_policy_version(self, policyName, policyDocument, setAsDefault):
        self.calls.append(("create_policy_version", policyName))
        self.policies[policyName] = policyDocument

    def describe_thing_group(self, thingGroupName):
        if thingGroupName not in self.groups:
            raise err("ResourceNotFoundException", "DescribeThingGroup")

    def create_thing_group(self, thingGroupName):
        self.calls.append(("create_thing_group", thingGroupName))
        self.groups.add(thingGroupName)

    def describe_provisioning_template(self, templateName):
        if templateName not in self.templates:
            raise err("ResourceNotFoundException", "DescribeProvisioningTemplate")
        return self.templates[templateName]

    def list_provisioning_template_versions(self, templateName):
        return {"versions": [{"versionId": 1}]}

    def create_provisioning_template(self, **kw):
        self.calls.append(("create_provisioning_template", kw["templateName"]))
        self.templates[kw["templateName"]] = {"templateBody": kw["templateBody"], "preProvisioningHook": kw["preProvisioningHook"], "enabled": kw["enabled"],
                                              "provisioningRoleArn": kw["provisioningRoleArn"]}

    def create_provisioning_template_version(self, templateName, templateBody, setAsDefault):
        self.calls.append(("create_provisioning_template_version", templateName))
        self.templates[templateName]["templateBody"] = templateBody

    def update_provisioning_template(self, templateName, enabled, provisioningRoleArn, preProvisioningHook):
        self.calls.append(("update_provisioning_template", templateName))
        self.templates[templateName].update(enabled=enabled, preProvisioningHook=preProvisioningHook)

    def create_keys_and_certificate(self, setAsActive):
        self.calls.append(("create_keys_and_certificate", None))
        cid = "a" * 64
        self.certs[cid] = "ACTIVE"
        return {"certificateArn": f"arn:aws:iot:ap-south-1:{ACCOUNT}:cert/{cid}", "certificateId": cid, "certificatePem": "CLAIM-CERT",
                "keyPair": {"PrivateKey": "CLAIM-PRIVATE-KEY", "PublicKey": "CLAIM-PUBLIC"}}

    def attach_policy(self, policyName, target):
        self.calls.append(("attach_policy", policyName))
        self.attached.append((policyName, target))


class FakeIam:
    def __init__(self):
        self.roles, self.calls = {}, []

    def get_role(self, RoleName):
        if RoleName not in self.roles:
            raise err("NoSuchEntity", "GetRole")
        return {"Role": {"Arn": self.roles[RoleName]}}

    def create_role(self, RoleName, AssumeRolePolicyDocument, Description):
        self.calls.append(("create_role", RoleName))
        self.roles[RoleName] = f"arn:aws:iam::{ACCOUNT}:role/{RoleName}"
        return {"Role": {"Arn": self.roles[RoleName]}}

    def attach_role_policy(self, RoleName, PolicyArn):
        self.calls.append(("attach_role_policy", RoleName, PolicyArn))


class FakeLambda:
    def __init__(self, role_not_ready_times=0):
        self.functions, self.permissions, self.calls = {}, [], []
        self.not_ready = role_not_ready_times

    def get_function(self, FunctionName):
        if FunctionName not in self.functions:
            raise err("ResourceNotFoundException", "GetFunction")
        return {}

    def create_function(self, **kw):
        self.calls.append(("create_function", kw["FunctionName"]))
        if self.not_ready > 0:
            self.not_ready -= 1
            raise err("InvalidParameterValueException", "CreateFunction", "The role defined for the function cannot be assumed by Lambda.")
        self.functions[kw["FunctionName"]] = kw

    def update_function_code(self, FunctionName, ZipFile, Publish):
        self.calls.append(("update_function_code", FunctionName))

    def update_function_configuration(self, FunctionName, Environment, Timeout):
        self.calls.append(("update_function_configuration", FunctionName))
        self.functions[FunctionName]["Environment"] = Environment

    def get_policy(self, FunctionName):
        if not self.permissions:
            raise err("ResourceNotFoundException", "GetPolicy")
        return {"Policy": json.dumps({"Statement": [{"Sid": s} for s in self.permissions]})}

    def add_permission(self, FunctionName, StatementId, Action, Principal, SourceAccount):
        self.calls.append(("add_permission", Principal))
        self.permissions.append(StatementId)


class DeployBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.claim_dir = os.path.join(self.tmp.name, "claim")
        self.iot, self.iam, self.lam = FakeIot(), FakeIam(), FakeLambda()
        self.sleeps = []

    def deployer(self, apply, update=False, url=URL, secret=SECRET):
        return cd.ClaimDeployer({"iot": self.iot, "iam": self.iam, "lambda": self.lam}, ACCOUNT, "ap-south-1", cd.Files.load(AWS_DIR), self.claim_dir,
                                url, secret, apply=apply, update=update, sleep=self.sleeps.append)

    def status(self, steps, name_part):
        return next(s.status for s in steps if name_part in s.name)


class TestSettings(DeployBase):
    def test_refuses_a_backend_address_aws_could_not_use_safely(self):
        with self.assertRaises(cd.DeploymentError):
            self.deployer(True, url="http://192.168.68.101:5000/api/v1/batches/provisioning/pre-hook").run()
        with self.assertRaises(cd.DeploymentError):
            self.deployer(True, url="https://api.example.com/").run()

    def test_refuses_an_empty_or_short_hook_secret(self):
        for secret in ("", "short"):
            with self.assertRaises(cd.DeploymentError) as ctx:
                self.deployer(True, secret=secret).run()
            self.assertIn("PROVISIONING_HOOK_SECRET", str(ctx.exception))
        self.assertEqual((self.iot.calls, self.iam.calls, self.lam.calls), ([], [], []))


class TestDryRun(DeployBase):
    def test_a_dry_run_creates_nothing_and_says_what_it_would(self):
        steps = self.deployer(False).run()
        self.assertTrue(all(s.status == cd.WOULD for s in steps), [(s.name, s.status) for s in steps])
        self.assertEqual((self.iot.calls, self.iam.calls, self.lam.calls), ([], [], []))
        self.assertFalse(os.path.exists(self.claim_dir))


class TestApply(DeployBase):
    def test_creates_everything_in_a_working_order(self):
        steps = self.deployer(True).run()
        self.assertTrue(all(s.status == cd.CREATED for s in steps), [(s.name, s.status) for s in steps])
        self.assertEqual(set(self.iot.policies), {cd.DEVICE_POLICY, cd.CLAIM_POLICY})
        self.assertEqual(set(self.iam.roles), {cd.IOT_ROLE, cd.LAMBDA_ROLE})
        self.assertIn(("attach_role_policy", cd.IOT_ROLE, cd.IOT_REGISTRATION_POLICY_ARN), self.iam.calls)
        self.assertEqual(self.iot.groups, {"production", "dev"})
        self.assertIn(cd.LAMBDA_NAME, self.lam.functions)
        self.assertEqual(self.lam.permissions, ["iot-invokes-provisioning-hook"])
        order = [c[0] for c in self.iot.calls]
        self.assertLess(order.index("create_thing_group"), order.index("create_provisioning_template"))

    def test_the_policies_carry_the_account_and_never_the_placeholder(self):
        self.deployer(True).run()
        for doc in self.iot.policies.values():
            self.assertIn(ACCOUNT, doc)
            self.assertNotIn("<ACCOUNT_ID>", doc)

    def test_the_lambda_gets_the_hook_address_and_secret_and_the_projects_own_code(self):
        self.deployer(True).run()
        fn = self.lam.functions[cd.LAMBDA_NAME]
        self.assertEqual(fn["Environment"]["Variables"], {"BACKEND_HOOK_URL": URL, "HOOK_SECRET": SECRET})
        self.assertEqual(fn["Handler"], "provisioning_hook.lambda_handler")
        with zipfile.ZipFile(io.BytesIO(fn["Code"]["ZipFile"])) as zf:
            self.assertEqual(zf.namelist(), ["provisioning_hook.py"])
            self.assertIn("def lambda_handler", zf.read("provisioning_hook.py").decode())

    def test_the_template_uses_the_lambda_as_its_pre_provisioning_hook(self):
        self.deployer(True).run()
        t = self.iot.templates[cd.TEMPLATE]
        self.assertEqual(t["preProvisioningHook"], {"targetArn": f"arn:aws:lambda:ap-south-1:{ACCOUNT}:function:{cd.LAMBDA_NAME}"})
        self.assertTrue(t["enabled"])
        self.assertEqual(t["provisioningRoleArn"], f"arn:aws:iam::{ACCOUNT}:role/{cd.IOT_ROLE}")

    def test_the_claim_certificate_is_saved_with_the_claim_policy_and_only_once(self):
        self.deployer(True).run()
        self.assertEqual(sorted(os.listdir(self.claim_dir)), sorted(cd.CLAIM_FILES))
        self.assertEqual(open(os.path.join(self.claim_dir, cd.CLAIM_FILES[1])).read(), "CLAIM-PRIVATE-KEY")
        self.assertEqual([p for p, _ in self.iot.attached], [cd.CLAIM_POLICY], "the claim certificate gets the claim policy, never the device policy")
        steps = self.deployer(True).run()
        self.assertEqual(self.status(steps, "Claim certificate"), cd.EXISTS)
        self.assertEqual(len(self.iot.certs), 1)

    def test_a_rerun_changes_nothing(self):
        self.deployer(True).run()
        before = (list(self.iot.calls), list(self.iam.calls), list(self.lam.calls))
        steps = self.deployer(True).run()
        self.assertTrue(all(s.status == cd.EXISTS for s in steps), [(s.name, s.status) for s in steps])
        self.assertEqual((self.iot.calls, self.iam.calls, self.lam.calls), before)

    def test_a_role_that_is_not_ready_yet_is_waited_for(self):
        self.lam = FakeLambda(role_not_ready_times=3)
        steps = self.deployer(True).run()
        self.assertEqual(self.status(steps, "Lambda agripump"), cd.CREATED)
        self.assertEqual(len(self.sleeps), 3)

    def test_other_aws_errors_are_not_swallowed(self):
        class Denied(FakeLambda):
            def create_function(self, **kw):
                raise err("AccessDeniedException", "CreateFunction")
        self.lam = Denied()
        with self.assertRaises(ClientError):
            self.deployer(True).run()


class TestExistingButDifferent(DeployBase):
    def setUp(self):
        super().setUp()
        self.deployer(True).run()

    def test_a_changed_policy_is_reported_and_left_alone_unless_update_is_asked_for(self):
        self.iot.policies[cd.DEVICE_POLICY] = json.dumps({"Version": "2012-10-17", "Statement": []})
        steps = self.deployer(True).run()
        self.assertEqual(self.status(steps, cd.DEVICE_POLICY), cd.DIFFERS)
        self.assertEqual(json.loads(self.iot.policies[cd.DEVICE_POLICY])["Statement"], [])
        steps = self.deployer(True, update=True).run()
        self.assertEqual(self.status(steps, cd.DEVICE_POLICY), cd.UPDATED)
        self.assertGreater(len(json.loads(self.iot.policies[cd.DEVICE_POLICY])["Statement"]), 0)

    def test_a_changed_template_is_reported_and_updated_only_on_request(self):
        self.iot.templates[cd.TEMPLATE]["templateBody"] = json.dumps({"Resources": {}})
        self.assertEqual(self.status(self.deployer(True).run(), "template"), cd.DIFFERS)
        self.assertEqual(self.status(self.deployer(True, update=True).run(), "template"), cd.UPDATED)
        self.assertIn("certificate", json.loads(self.iot.templates[cd.TEMPLATE]["templateBody"])["Resources"])

    def test_a_dry_run_never_updates_even_with_update_set(self):
        self.iot.policies[cd.CLAIM_POLICY] = json.dumps({"Version": "2012-10-17", "Statement": []})
        before = list(self.iot.calls)
        steps = self.deployer(False, update=True).run()
        self.assertEqual(self.status(steps, cd.CLAIM_POLICY), cd.DIFFERS)
        self.assertEqual(self.iot.calls, before)


if __name__ == "__main__":
    unittest.main()
