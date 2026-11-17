"""Scan a starter's barcode, and its whole identity is made: the pump in the system, and in AWS the thing, the certificate and the policy.

No person does anything between the scan and the certificate package. This is plain program logic, the same every time (no AI is involved):

  1. the ID must be on an uploaded factory sheet, its batch not revoked, and not registered before;
  2. the pump is made as stock in the tree of the admin who uploaded the sheet, so that admin (and their distributors and dealers) can give it to a farmer;
  3. in AWS: a thing named exactly like the ID, a new certificate and key, the device policy attached, the certificate attached to the thing;
  4. the ID is marked registered and the action is written to the audit log;
  5. one zip comes back: the certificate, the private key, Amazon's root certificate and a short note. The private key is shown once and not kept anywhere.

Nothing is left half done: the database changes are only committed after AWS has succeeded, and if the commit fails what was made in AWS is removed again.
The AWS client is passed in (boto3's `iot`), so the logic is tested without AWS.
"""
from __future__ import annotations

import io
import os
import re
import zipfile
from dataclasses import dataclass
from typing import Any, Optional

from botocore.exceptions import ClientError
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AuditLog, BatchImei, DeviceBatch, DeviceConfig, Pump, User
from app.services.device_provisioning import THING_NAME, FactoryProvisioner

ROOT_CA_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "AmazonRootCA1.pem.txt")
STOCK_STATE = "MANUFACTURED"      # "device created in OEM inventory, not yet connected": the state a farmer can still be registered on


@dataclass
class Package:
    filename: str
    content: bytes
    certificate_id: str


def starter_id_of(record: BatchImei) -> str:
    return (record.mcu_uid or record.imei or "").strip()


def iot_client() -> Any:
    """boto3's IoT control-plane client, using the server's own AWS identity (its instance role). Built on use, so the app starts without AWS."""
    import boto3

    from app.services.iot_publisher import apply_network_preference

    apply_network_preference()
    return boto3.client("iot", region_name=settings.AWS_REGION)


def stock_pump_for(db: Session, batch: DeviceBatch, record: BatchImei, serial: str) -> Pump:
    """The pump row for a starter, made as stock in the tree of the admin who uploaded its sheet (or the platform owner when nobody did).

    Before this the row sat at the platform owner's top level, where no admin could see it, in a state a farmer could not be registered on.
    """
    pump = db.query(Pump).filter(Pump.id == serial).first()
    if pump is not None:
        return pump
    owner = db.query(User).filter(User.id == batch.created_by).first() if batch.created_by else None
    if owner is None:
        owner = db.query(User).filter(User.role == "superadmin").first()
    pump = Pump(
        id=serial,
        name=f"Pump {serial[-6:]}",
        device_type=getattr(batch, "device_type", "AC_3PH") or "AC_3PH",
        supply_type=record.supply_type or "3-phase",
        hp_rating=record.hp_rating if record.hp_rating is not None else 7.5,
        owner_user_id=owner.id if owner is not None else None,
        hierarchy_path=(owner.hierarchy_path if owner is not None and owner.hierarchy_path else "/SA"),
        status="STOPPED",
        lifecycle_state=STOCK_STATE,
        brand_id=batch.brand_id,
        firmware_version=None,
    )
    db.add(pump)
    db.add(DeviceConfig(pump_id=serial, desired_json={"ol": 25.0, "ov": 480, "dr": 1, "dr_t": 5}, status="APPLIED"))
    db.flush()
    return pump


def _root_ca() -> bytes:
    with open(ROOT_CA_FILE, "rb") as fh:
        return fh.read()


def _package(serial: str, cert_id: str, keys: dict) -> Package:
    note = (
        f"Starter {serial}\n\n"
        "certificate.pem.crt  the module's certificate\n"
        "private.pem.key      the module's private key. SECRET: keep it private, it cannot be downloaded from AWS again.\n"
        "AmazonRootCA1.pem    Amazon's public root certificate (the module needs it to trust AWS)\n\n"
        f"The thing name and the MQTT client id are both: {serial}\n"
        f"IoT endpoint: {settings.IOT_DATA_ENDPOINT or '(see the AWS IoT console, Settings)'}\n"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{serial}/certificate.pem.crt", keys["certificatePem"])
        z.writestr(f"{serial}/private.pem.key", keys["keyPair"]["PrivateKey"])
        z.writestr(f"{serial}/AmazonRootCA1.pem", _root_ca())
        z.writestr(f"{serial}/README.txt", note)
    return Package(f"{serial}-aws-identity.zip", buf.getvalue(), cert_id)


def _code(exc: Exception) -> str:
    return str(getattr(exc, "response", {}).get("Error", {}).get("Code", ""))


def register(db: Session, actor: User, record: BatchImei, batch: Optional[DeviceBatch], iot: Any = None) -> Package:
    """Make the starter's identity (see the module note). Raises HTTPException with a plain reason when it cannot."""
    if not settings.STARTER_REGISTRATION:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Registering starters in AWS is not switched on for this server.")
    serial = starter_id_of(record)
    if not THING_NAME.match(serial):
        raise HTTPException(status_code=422, detail="That starter's ID has characters AWS does not accept (letters, digits and : _ - only, at most 50).")
    if batch is None or batch.revoked:
        raise HTTPException(status_code=409, detail="That starter's batch has been revoked.")
    if record.claimed:
        raise HTTPException(
            status_code=409,
            detail="That starter is already registered. Its private key was shown once and cannot be shown again; to issue a new one, switch the old certificate off first.",
        )

    iot = iot or iot_client()
    provisioner = FactoryProvisioner(iot, settings.IOT_DEVICE_POLICY_NAME, out_dir="", root_ca_pem=None, apply=True)
    try:
        provisioner.check_policy()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AWS is not ready: {exc}")
    try:
        iot.describe_thing(thingName=serial)
        raise HTTPException(
            status_code=409,
            detail=f"A thing named {serial} already exists in AWS (made by hand or earlier). Remove it in the AWS console first, or keep using its existing certificate.",
        )
    except ClientError as exc:
        if _code(exc) != "ResourceNotFoundException":
            raise HTTPException(status_code=502, detail=f"AWS could not be reached: {_code(exc) or type(exc).__name__}")

    # The pump row first (not saved yet), so a problem there stops us before anything is made in AWS.
    pump = stock_pump_for(db, batch, record, serial)

    made_thing, cert_arn, cert_id = False, "", ""
    try:
        iot.create_thing(thingName=serial)
        made_thing = True
        keys = iot.create_keys_and_certificate(setAsActive=True)
        cert_arn, cert_id = keys["certificateArn"], keys["certificateId"]
        iot.attach_policy(policyName=settings.IOT_DEVICE_POLICY_NAME, target=cert_arn)
        iot.attach_thing_principal(thingName=serial, principal=cert_arn)
        package = _package(serial, cert_id, keys)
    except Exception as exc:
        db.rollback()
        provisioner._rollback(serial, made_thing, cert_arn, cert_id, "")
        raise HTTPException(status_code=502, detail=f"AWS refused a step ({_code(exc) or type(exc).__name__}). Nothing was kept; try again.")

    try:
        from datetime import datetime

        record.claimed = True
        record.claimed_at = datetime.utcnow()
        record.pump_id = pump.id
        db.add(AuditLog(
            actor_id=actor.id, actor_role=actor.role, entity_type="pump", entity_id=pump.id,
            action="STARTER_REGISTERED_IN_AWS", after_json={"starter_id": serial, "certificate_id": cert_id, "batch": batch.batch_code},
        ))
        db.commit()
    except Exception:
        db.rollback()
        provisioner._rollback(serial, made_thing, cert_arn, cert_id, "")
        raise HTTPException(status_code=500, detail="The database could not save the registration. What was made in AWS has been removed; try again.")
    return package
