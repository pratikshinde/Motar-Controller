"""Factory provisioning: create each starter's AWS IoT identity (a thing named exactly like the starter ID, its own certificate and key).

The thing name, the MQTT client id and `pumps.id` are one string (see aws/README.md), so the thing is named with the starter ID printed on the
box. Each starter gets its own certificate, with the device policy attached, and the three files (certificate, private key, public key) plus
the Amazon root CA are saved in one folder per starter, ready to be loaded onto that module at the factory.

Safe by construction:
  * a dry run is the default: nothing is created until `apply=True`;
  * a thing that already exists is never touched, and a folder that already holds files is never overwritten (a private key exists once);
  * if any step for one starter fails, whatever was created for it is removed again, so a rerun starts clean;
  * the private key is written to disk the moment AWS returns it (it is shown once and cannot be fetched again), and is never printed or
    put in the manifest.

The AWS client is passed in (boto3's `iot`), so the logic is tested without AWS.
"""
from __future__ import annotations

import csv
import os
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from botocore.exceptions import ClientError

THING_NAME = re.compile(r"^[A-Za-z0-9:_-]{1,50}$")      # the same rule the provisioning hook applies to a serial
ROOT_CA_NAME = "AmazonRootCA1.pem"

# Statuses
WOULD_CREATE, CREATED, EXISTS, INVALID, FAILED = "would-create", "created", "exists", "invalid", "failed"
WOULD_REVOKE, REVOKED, NO_CERTIFICATE, NOT_FOUND = "would-revoke", "revoked", "no-certificate", "not-found"

_ID_HEADERS = {"starter_id", "starter", "id", "serial", "device_id", "dev_id", "thing", "thing_name", "pump_id"}


class ProvisioningError(Exception):
    """Something that stops the whole run (the policy is missing, wrong identity), as opposed to one starter failing."""


@dataclass
class Result:
    starter_id: str
    status: str
    detail: str = ""
    certificate_id: str = ""
    certificate_arn: str = ""
    folder: str = ""


def parse_ids(text: str) -> Tuple[List[str], List[str]]:
    """Starter IDs from a pasted list or a CSV: one per line (in a CSV the first column), or several on a line separated by spaces. '#' starts a comment.

    A first line that names a column (starter_id, serial, ...) is a header. Returns (unique ids in order, ids refused with the reason).
    """
    ids: List[str] = []
    refused: List[str] = []
    seen = set()
    for n, line in enumerate(text.splitlines()):
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        cells = [c.strip().strip('"') for c in re.split(r"[,;\t]", line)]
        first = cells[0]
        if n == 0 and first.lower() in _ID_HEADERS:
            continue
        # A line of several valid IDs separated by spaces ("A1 A2 A3") is several IDs; anything else with a space in it is one bad ID,
        # not two good ones. In a CSV row (commas) the first column is the ID and the rest are other data (IMEI, batch, ...).
        tokens = first.split()
        candidates = tokens if len(tokens) > 1 and all(THING_NAME.match(t) for t in tokens) else [first]
        for cid in candidates:
            if not THING_NAME.match(cid):
                refused.append(f"{cid!r}: use letters, digits, : _ - only, up to 50 characters")
            elif cid not in seen:
                seen.add(cid)
                ids.append(cid)
    return ids, refused


def _code(exc: Exception) -> str:
    return str(getattr(exc, "response", {}).get("Error", {}).get("Code", ""))


def _short(exc: Exception) -> str:
    msg = f"{type(exc).__name__}: {exc}"
    return msg.replace("\n", " ")[:300]


class FactoryProvisioner:
    def __init__(
        self,
        iot: Any,
        policy_name: str,
        out_dir: str,
        root_ca_pem: Optional[bytes] = None,
        apply: bool = False,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ):
        self.iot = iot
        self.policy_name = policy_name
        self.out_dir = out_dir
        self.root_ca_pem = root_ca_pem
        self.apply = apply
        self.now = now

    # -- checks ---------------------------------------------------------------------------------------------------------------------
    def check_policy(self) -> None:
        """The device policy must already exist (it is created once, in the console: aws/README.md). Its absence stops the run."""
        try:
            self.iot.get_policy(policyName=self.policy_name)
        except ClientError as exc:
            if _code(exc) == "ResourceNotFoundException":
                raise ProvisioningError(
                    f"The IoT policy '{self.policy_name}' does not exist in this account and region. Create it first from "
                    "aws/policies/device-policy.json (IoT Core > Security > Policies)."
                )
            raise ProvisioningError(f"Could not read the policy '{self.policy_name}': {_short(exc)}")

    def _thing_exists(self, thing: str) -> bool:
        try:
            self.iot.describe_thing(thingName=thing)
            return True
        except ClientError as exc:
            if _code(exc) == "ResourceNotFoundException":
                return False
            raise

    # -- create ---------------------------------------------------------------------------------------------------------------------
    def provision(self, ids: Iterable[str]) -> List[Result]:
        results: List[Result] = []
        for starter_id in ids:
            if not THING_NAME.match(starter_id):
                results.append(Result(starter_id, INVALID, "not a valid starter ID"))
                continue
            try:
                results.append(self._provision_one(starter_id))
            except Exception as exc:        # one starter failing must not stop the others
                results.append(Result(starter_id, FAILED, _short(exc)))
        return results

    def _provision_one(self, starter_id: str) -> Result:
        folder = os.path.join(self.out_dir, starter_id)
        if self._thing_exists(starter_id):
            return Result(starter_id, EXISTS, "the thing already exists in AWS; nothing was created or changed")
        if os.path.isdir(folder) and os.listdir(folder):
            return Result(starter_id, FAILED, f"the folder {folder} already has files; it is never overwritten (it may hold the only copy of a key)")
        if not self.apply:
            return Result(starter_id, WOULD_CREATE, "dry run: nothing created", folder=folder)

        made_thing = False
        cert_arn = cert_id = ""
        try:
            self.iot.create_thing(thingName=starter_id)
            made_thing = True
            keys = self.iot.create_keys_and_certificate(setAsActive=True)
            cert_arn, cert_id = keys["certificateArn"], keys["certificateId"]
            # The private key is shown once. Save it before anything else can fail.
            self._save(folder, cert_id, keys)
            self.iot.attach_policy(policyName=self.policy_name, target=cert_arn)
            self.iot.attach_thing_principal(thingName=starter_id, principal=cert_arn)
        except Exception as exc:
            self._rollback(starter_id, made_thing, cert_arn, cert_id, folder)
            return Result(starter_id, FAILED, f"{_short(exc)} (what was created for it has been removed)")
        return Result(starter_id, CREATED, "thing, certificate and policy created; files saved", cert_id, cert_arn, folder)

    def _save(self, folder: str, cert_id: str, keys: Dict[str, Any]) -> None:
        os.makedirs(folder, exist_ok=True)
        files = {
            f"{cert_id}-certificate.pem.crt": keys["certificatePem"],
            f"{cert_id}-private.pem.key": keys["keyPair"]["PrivateKey"],
            f"{cert_id}-public.pem.key": keys["keyPair"]["PublicKey"],
        }
        for name, content in files.items():
            path = os.path.join(folder, name)
            with open(path, "w", encoding="ascii", newline="\n") as fh:
                fh.write(content)
            if name.endswith("-private.pem.key"):
                try:
                    os.chmod(path, 0o600)       # best effort: Windows ignores it
                except OSError:
                    pass
        if self.root_ca_pem:
            with open(os.path.join(folder, ROOT_CA_NAME), "wb") as fh:
                fh.write(self.root_ca_pem)

    def _rollback(self, starter_id: str, made_thing: bool, cert_arn: str, cert_id: str, folder: str) -> None:
        """Best effort, each step on its own: whatever is left is named in the failure so a person can finish it."""
        def attempt(fn):
            try:
                fn()
            except Exception:
                pass
        if cert_arn:
            attempt(lambda: self.iot.detach_thing_principal(thingName=starter_id, principal=cert_arn))
            attempt(lambda: self.iot.detach_policy(policyName=self.policy_name, target=cert_arn))
            attempt(lambda: self.iot.update_certificate(certificateId=cert_id, newStatus="INACTIVE"))
            attempt(lambda: self.iot.delete_certificate(certificateId=cert_id, forceDelete=True))
        if made_thing:
            attempt(lambda: self.iot.delete_thing(thingName=starter_id))
        attempt(lambda: shutil.rmtree(folder, ignore_errors=True))

    # -- revoke ---------------------------------------------------------------------------------------------------------------------
    def revoke(self, ids: Iterable[str]) -> List[Result]:
        """Switches a starter's certificate(s) off (INACTIVE) and detaches them from the thing. Nothing is deleted: it can be undone in the console."""
        results: List[Result] = []
        for starter_id in ids:
            try:
                results.append(self._revoke_one(starter_id))
            except ClientError as exc:
                if _code(exc) == "ResourceNotFoundException":
                    results.append(Result(starter_id, NOT_FOUND, "no such thing in AWS"))
                else:
                    results.append(Result(starter_id, FAILED, _short(exc)))
            except Exception as exc:
                results.append(Result(starter_id, FAILED, _short(exc)))
        return results

    def _revoke_one(self, starter_id: str) -> Result:
        principals = self.iot.list_thing_principals(thingName=starter_id).get("principals", [])
        certs = [p for p in principals if ":cert/" in p]
        if not certs:
            return Result(starter_id, NO_CERTIFICATE, "the thing has no certificate attached")
        if not self.apply:
            return Result(starter_id, WOULD_REVOKE, f"dry run: would switch off {len(certs)} certificate(s)", certificate_arn=certs[0])
        for arn in certs:
            self.iot.update_certificate(certificateId=arn.rsplit("/", 1)[1], newStatus="INACTIVE")
            self.iot.detach_thing_principal(thingName=starter_id, principal=arn)
        return Result(starter_id, REVOKED, f"{len(certs)} certificate(s) switched off and detached", certs[0].rsplit("/", 1)[1], certs[0])

    # -- the record -----------------------------------------------------------------------------------------------------------------
    def write_manifest(self, results: List[Result], kind: str = "provision") -> str:
        """A CSV of what happened, for the factory's records. Holds no key material."""
        os.makedirs(self.out_dir, exist_ok=True)
        stamp = self.now().strftime("%Y%m%d-%H%M%S")
        path = os.path.join(self.out_dir, f"manifest-{kind}-{stamp}{'' if self.apply else '-dryrun'}.csv")
        with open(path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["starter_id", "status", "certificate_id", "certificate_arn", "folder", "detail", "at"])
            at = self.now().isoformat()
            for r in results:
                w.writerow([r.starter_id, r.status, r.certificate_id, r.certificate_arn, r.folder, r.detail, at])
        return path
