"""One-time AWS setup for fleet provisioning by claim (aws/README.md), as code, so nobody clicks it together in the console.

Each starter's own certificate is issued by AWS the first time the module powers up, after the backend has said that its ID is on the factory
list and unused (aws/lambda/provisioning_hook.py asks the backend). This module creates everything that makes that work:

    1. the IoT device policy and the claim policy                (from aws/policies/*.json, <ACCOUNT_ID> filled in)
    2. the IAM role AWS IoT uses to register things             (AWSIoTThingsRegistration)
    3. the Lambda's own role, and the Lambda `agripump-provisioning-hook` with its settings, and permission for AWS IoT to call it
    4. the thing groups the template files things under
    5. the provisioning template `agripump-fleet`, with the Lambda as its pre-provisioning hook
    6. the claim certificate and key (one for all modules), with the claim policy attached

Every step looks first and only creates what is missing; a rerun changes nothing. A thing that exists but differs (a policy, the template) is reported,
and changed only when `update=True`. Nothing is deleted. The AWS clients are passed in, so all of it is tested without AWS.
"""
from __future__ import annotations

import io
import json
import os
import time
import zipfile
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from botocore.exceptions import ClientError

DEVICE_POLICY = "agripump-device-policy"
CLAIM_POLICY = "agripump-claim-policy"
TEMPLATE = "agripump-fleet"
LAMBDA_NAME = "agripump-provisioning-hook"
IOT_ROLE = "agripump-iot-provisioning"
LAMBDA_ROLE = "agripump-provisioning-hook-role"
THING_GROUPS = ("production", "dev")
IOT_REGISTRATION_POLICY_ARN = "arn:aws:iam::aws:policy/service-role/AWSIoTThingsRegistration"
LAMBDA_BASIC_POLICY_ARN = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
LAMBDA_RUNTIME = "python3.12"
CLAIM_FILES = ("claim-certificate.pem.crt", "claim-private.pem.key")

CREATED, EXISTS, DIFFERS, UPDATED, WOULD = "created", "exists", "differs", "updated", "would-create"

_TRUST_IOT = {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": "iot.amazonaws.com"}, "Action": "sts:AssumeRole"}]}
_TRUST_LAMBDA = {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]}


class DeploymentError(Exception):
    """Stops the whole run: a missing file or setting, or the wrong identity."""


@dataclass
class Step:
    name: str
    status: str
    detail: str = ""


@dataclass
class Files:
    """The project's own AWS files, read once."""
    device_policy: str
    claim_policy: str
    template: str
    lambda_source: str

    @classmethod
    def load(cls, aws_dir: str) -> "Files":
        def read(*parts):
            path = os.path.join(aws_dir, *parts)
            try:
                with open(path, encoding="utf-8") as fh:
                    return fh.read()
            except OSError as exc:
                raise DeploymentError(f"Cannot read {path}: {exc}")
        return cls(
            device_policy=read("policies", "device-policy.json"),
            claim_policy=read("policies", "claim-policy.json"),
            template=read("provisioning-template.json"),
            lambda_source=read("lambda", "provisioning_hook.py"),
        )


def _code(exc: Exception) -> str:
    return str(getattr(exc, "response", {}).get("Error", {}).get("Code", ""))


def _normal(doc) -> str:
    """A JSON document in one canonical form, so two spellings of the same policy compare equal."""
    if isinstance(doc, str):
        doc = json.loads(doc)
    return json.dumps(doc, sort_keys=True, separators=(",", ":"))


def lambda_zip(source: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        info = zipfile.ZipInfo("provisioning_hook.py", date_time=(2026, 1, 1, 0, 0, 0))     # fixed time: the same source is the same zip
        info.external_attr = 0o644 << 16
        zf.writestr(info, source)
    return buf.getvalue()


class ClaimDeployer:
    def __init__(self, session_clients: Dict[str, Any], account_id: str, region: str, files: Files, claim_dir: str,
                 backend_url: str, hook_secret: str, apply: bool = False, update: bool = False, sleep=time.sleep):
        self.iot = session_clients["iot"]
        self.iam = session_clients["iam"]
        self.lam = session_clients["lambda"]
        self.account_id = account_id
        self.region = region
        self.files = files
        self.claim_dir = claim_dir
        self.backend_url = backend_url
        self.hook_secret = hook_secret
        self.apply = apply
        self.update = update
        self.sleep = sleep
        self.steps: List[Step] = []
        self._role_arns: Dict[str, str] = {}

    # -- plumbing -------------------------------------------------------------------------------------------------------------------
    def _fill(self, text: str) -> str:
        return text.replace("<ACCOUNT_ID>", self.account_id)

    def _record(self, name: str, status: str, detail: str = "") -> Step:
        step = Step(name, status, detail)
        self.steps.append(step)
        return step

    def check_settings(self) -> None:
        if not self.backend_url.startswith("https://"):
            raise DeploymentError("The backend URL must be public and start with https:// (AWS calls it when a starter claims its certificate).")
        if "/api/v1/batches/provisioning/pre-hook" not in self.backend_url:
            raise DeploymentError("The backend URL must be the full hook address, ending in /api/v1/batches/provisioning/pre-hook.")
        if len(self.hook_secret) < 24:
            raise DeploymentError("PROVISIONING_HOOK_SECRET is empty or too short (at least 24 characters). Set it in backend/.env first; the same value is given to the Lambda.")

    def _retry_new_role(self, fn):
        """A role created seconds ago is not yet usable by Lambda and IoT: AWS says so with an error that clears by itself. Try again for ~a minute."""
        for attempt in range(12):
            try:
                return fn()
            except ClientError as exc:
                text = str(exc).lower()
                if attempt < 11 and _code(exc) in ("InvalidParameterValueException", "InvalidRequestException") and "role" in text:
                    self.sleep(5)
                    continue
                raise

    # -- 1. policies ----------------------------------------------------------------------------------------------------------------
    def ensure_policy(self, name: str, document: str) -> Step:
        document = self._fill(document)
        try:
            current = self.iot.get_policy(policyName=name)["policyDocument"]
        except ClientError as exc:
            if _code(exc) != "ResourceNotFoundException":
                raise
            if not self.apply:
                return self._record(f"IoT policy {name}", WOULD)
            self.iot.create_policy(policyName=name, policyDocument=_normal(document))
            return self._record(f"IoT policy {name}", CREATED)
        if _normal(current) == _normal(document):
            return self._record(f"IoT policy {name}", EXISTS)
        if self.update and self.apply:
            self._new_policy_version(name, document)
            return self._record(f"IoT policy {name}", UPDATED, "a new default version was created")
        return self._record(f"IoT policy {name}", DIFFERS, "differs from aws/policies; rerun with --update to apply the file's version")

    def _new_policy_version(self, name: str, document: str) -> None:
        versions = self.iot.list_policy_versions(policyName=name)["policyVersions"]
        if len(versions) >= 5:           # IoT keeps at most five: drop the oldest that is not the default
            old = sorted((v for v in versions if not v["isDefaultVersion"]), key=lambda v: v.get("createDate", 0))[0]
            self.iot.delete_policy_version(policyName=name, policyVersionId=old["versionId"])
        self.iot.create_policy_version(policyName=name, policyDocument=_normal(document), setAsDefault=True)

    # -- 2, 3. roles and the Lambda --------------------------------------------------------------------------------------------------
    def ensure_role(self, name: str, trust: Dict[str, Any], managed_arn: str) -> Step:
        try:
            self._role_arns[name] = self.iam.get_role(RoleName=name)["Role"]["Arn"]
            return self._record(f"IAM role {name}", EXISTS)
        except ClientError as exc:
            if _code(exc) != "NoSuchEntity":
                raise
        if not self.apply:
            self._role_arns[name] = f"arn:aws:iam::{self.account_id}:role/{name}"
            return self._record(f"IAM role {name}", WOULD)
        created = self.iam.create_role(RoleName=name, AssumeRolePolicyDocument=json.dumps(trust), Description="AgriPump fleet provisioning")
        self.iam.attach_role_policy(RoleName=name, PolicyArn=managed_arn)
        self._role_arns[name] = created["Role"]["Arn"]
        return self._record(f"IAM role {name}", CREATED)

    def ensure_lambda(self) -> Step:
        role_arn = self._role_arns[LAMBDA_ROLE]
        env = {"Variables": {"BACKEND_HOOK_URL": self.backend_url, "HOOK_SECRET": self.hook_secret}}
        code = lambda_zip(self.files.lambda_source)
        try:
            self.lam.get_function(FunctionName=LAMBDA_NAME)
        except ClientError as exc:
            if _code(exc) != "ResourceNotFoundException":
                raise
            if not self.apply:
                return self._record(f"Lambda {LAMBDA_NAME}", WOULD)
            self._retry_new_role(lambda: self.lam.create_function(
                FunctionName=LAMBDA_NAME, Runtime=LAMBDA_RUNTIME, Role=role_arn, Handler="provisioning_hook.lambda_handler",
                Code={"ZipFile": code}, Timeout=15, MemorySize=128, Environment=env, Publish=True,
            ))
            return self._record(f"Lambda {LAMBDA_NAME}", CREATED)
        if self.update and self.apply:
            self.lam.update_function_code(FunctionName=LAMBDA_NAME, ZipFile=code, Publish=True)
            if hasattr(self.lam, "get_waiter"):
                self.lam.get_waiter("function_updated").wait(FunctionName=LAMBDA_NAME)       # a second update is refused while the first is running
            self.lam.update_function_configuration(FunctionName=LAMBDA_NAME, Environment=env, Timeout=15)
            return self._record(f"Lambda {LAMBDA_NAME}", UPDATED, "code and settings replaced")
        return self._record(f"Lambda {LAMBDA_NAME}", EXISTS, "left as it is (use --update to replace its code and settings)")

    def ensure_lambda_permission(self) -> Step:
        sid = "iot-invokes-provisioning-hook"
        try:
            policy = json.loads(self.lam.get_policy(FunctionName=LAMBDA_NAME)["Policy"])
            if any(s.get("Sid") == sid for s in policy.get("Statement", [])):
                return self._record("Lambda permission for AWS IoT", EXISTS)
        except ClientError as exc:
            if _code(exc) != "ResourceNotFoundException":
                raise
        if not self.apply:
            return self._record("Lambda permission for AWS IoT", WOULD)
        self.lam.add_permission(FunctionName=LAMBDA_NAME, StatementId=sid, Action="lambda:InvokeFunction", Principal="iot.amazonaws.com",
                                SourceAccount=self.account_id)
        return self._record("Lambda permission for AWS IoT", CREATED)

    # -- 4. thing groups ------------------------------------------------------------------------------------------------------------
    def ensure_thing_groups(self) -> List[Step]:
        out = []
        for group in THING_GROUPS:
            try:
                self.iot.describe_thing_group(thingGroupName=group)
                out.append(self._record(f"Thing group {group}", EXISTS))
            except ClientError as exc:
                if _code(exc) != "ResourceNotFoundException":
                    raise
                if self.apply:
                    self.iot.create_thing_group(thingGroupName=group)
                    out.append(self._record(f"Thing group {group}", CREATED))
                else:
                    out.append(self._record(f"Thing group {group}", WOULD))
        return out

    # -- 5. template ----------------------------------------------------------------------------------------------------------------
    def ensure_template(self) -> Step:
        hook = {"targetArn": f"arn:aws:lambda:{self.region}:{self.account_id}:function:{LAMBDA_NAME}"}
        role_arn = self._role_arns[IOT_ROLE]
        body = self.files.template
        try:
            self.iot.describe_provisioning_template(templateName=TEMPLATE)
        except ClientError as exc:
            if _code(exc) != "ResourceNotFoundException":
                raise
            if not self.apply:
                return self._record(f"Provisioning template {TEMPLATE}", WOULD)
            self._retry_new_role(lambda: self.iot.create_provisioning_template(
                templateName=TEMPLATE, description="AgriPump: claim a certificate on first power-up", templateBody=body, enabled=True,
                provisioningRoleArn=role_arn, preProvisioningHook=hook, type="FLEET_PROVISIONING",
            ))
            return self._record(f"Provisioning template {TEMPLATE}", CREATED)
        versions = self.iot.list_provisioning_template_versions(templateName=TEMPLATE).get("versions", [])
        current = self.iot.describe_provisioning_template(templateName=TEMPLATE)
        same_body = _normal(current.get("templateBody", "{}")) == _normal(body)
        same_hook = (current.get("preProvisioningHook") or {}).get("targetArn") == hook["targetArn"]
        if same_body and same_hook and current.get("enabled", True):
            return self._record(f"Provisioning template {TEMPLATE}", EXISTS)
        if self.update and self.apply:
            if not same_body:
                self.iot.create_provisioning_template_version(templateName=TEMPLATE, templateBody=body, setAsDefault=True)
            self.iot.update_provisioning_template(templateName=TEMPLATE, enabled=True, provisioningRoleArn=role_arn, preProvisioningHook=hook)
            return self._record(f"Provisioning template {TEMPLATE}", UPDATED, f"{len(versions)} earlier version(s) kept")
        return self._record(f"Provisioning template {TEMPLATE}", DIFFERS, "differs from aws/provisioning-template.json; rerun with --update")

    # -- 6. claim certificate -------------------------------------------------------------------------------------------------------
    def ensure_claim_certificate(self) -> Step:
        cert_path, key_path = (os.path.join(self.claim_dir, n) for n in CLAIM_FILES)
        if os.path.isfile(cert_path) and os.path.isfile(key_path):
            return self._record("Claim certificate", EXISTS, f"files already in {self.claim_dir}; a second one is never made")
        if os.path.isdir(self.claim_dir) and os.listdir(self.claim_dir):
            raise DeploymentError(f"{self.claim_dir} already holds files but not a full claim certificate and key; clear it up by hand first.")
        if not self.apply:
            return self._record("Claim certificate", WOULD)
        keys = self.iot.create_keys_and_certificate(setAsActive=True)
        os.makedirs(self.claim_dir, exist_ok=True)
        for path, content in ((cert_path, keys["certificatePem"]), (key_path, keys["keyPair"]["PrivateKey"])):
            with open(path, "w", encoding="ascii", newline="\n") as fh:
                fh.write(content)
        try:
            os.chmod(key_path, 0o600)
        except OSError:
            pass
        self.iot.attach_policy(policyName=CLAIM_POLICY, target=keys["certificateArn"])
        return self._record("Claim certificate", CREATED, f"saved in {self.claim_dir} (certificate id {keys['certificateId'][:12]}...)")

    # -- the whole thing ------------------------------------------------------------------------------------------------------------
    def run(self) -> List[Step]:
        self.check_settings()
        self.ensure_policy(DEVICE_POLICY, self.files.device_policy)
        self.ensure_policy(CLAIM_POLICY, self.files.claim_policy)
        self.ensure_role(IOT_ROLE, _TRUST_IOT, IOT_REGISTRATION_POLICY_ARN)
        self.ensure_role(LAMBDA_ROLE, _TRUST_LAMBDA, LAMBDA_BASIC_POLICY_ARN)
        self.ensure_lambda()
        self.ensure_lambda_permission()
        self.ensure_thing_groups()
        self.ensure_template()
        self.ensure_claim_certificate()
        return self.steps
