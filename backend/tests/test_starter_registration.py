"""Scan a starter, and its whole identity is made without a person: the pump as stock for the admin, and in AWS the thing, certificate and policy.

AWS is a fake here (the logic takes the client as an argument); nothing real is touched.
"""
import io
import os
import sys
import unittest
import uuid
import zipfile
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.models import AppBrand, AuditLog, BatchImei, DeviceBatch, Pump, User
from test_web_portal_hardening import MfaBase  # noqa: E402  (the base class only)
from test_web_portal_users import _h, _partner  # noqa: E402

client = TestClient(app)
API = "/api/v1"


def _no_thing():
    return ClientError({"Error": {"Code": "ResourceNotFoundException", "Message": "no"}}, "DescribeThing")


class FakeIot:
    """Just enough of boto3's IoT client; records what was asked."""

    def __init__(self, thing_exists=False, fail_at=None, policy_exists=True):
        self.thing_exists, self.fail_at, self.policy_exists = thing_exists, fail_at, policy_exists
        self.calls = []

    def _do(self, name, **kw):
        self.calls.append((name, kw))
        if self.fail_at == name:
            raise ClientError({"Error": {"Code": "InternalFailure", "Message": "boom"}}, name)

    def get_policy(self, policyName):
        self.calls.append(("get_policy", {"policyName": policyName}))
        if not self.policy_exists:
            raise ClientError({"Error": {"Code": "ResourceNotFoundException", "Message": "no"}}, "GetPolicy")
        return {}

    def describe_thing(self, thingName):
        self.calls.append(("describe_thing", {"thingName": thingName}))
        if self.thing_exists:
            return {"thingName": thingName}
        raise _no_thing()

    def create_thing(self, **kw):
        self._do("create_thing", **kw)

    def create_keys_and_certificate(self, **kw):
        self._do("create_keys_and_certificate", **kw)
        return {"certificateArn": "arn:aws:iot:ap-south-1:1:cert/abc123", "certificateId": "abc123",
                "certificatePem": "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n",
                "keyPair": {"PrivateKey": "-----BEGIN RSA PRIVATE KEY-----\nSECRET\n-----END RSA PRIVATE KEY-----\n", "PublicKey": "PUB"}}

    def attach_policy(self, **kw):
        self._do("attach_policy", **kw)

    def attach_thing_principal(self, **kw):
        self._do("attach_thing_principal", **kw)

    # used by the rollback
    def detach_thing_principal(self, **kw):
        self.calls.append(("detach_thing_principal", kw))

    def detach_policy(self, **kw):
        self.calls.append(("detach_policy", kw))

    def update_certificate(self, **kw):
        self.calls.append(("update_certificate", kw))

    def delete_certificate(self, **kw):
        self.calls.append(("delete_certificate", kw))

    def delete_thing(self, **kw):
        self.calls.append(("delete_thing", kw))

    def names(self):
        return [c[0] for c in self.calls]


class Base(MfaBase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.batches, cls.pumps = [], []
        cls.admin = None

    def setUp(self):
        cls = type(self)
        if cls.admin is None:
            cls.sa = _partner(self, "superadmin", "reg-sa")
            cls.admin = _partner(self, "manufacturer", "reg-admin", parent=cls.sa)
            cls.other_admin = _partner(self, "manufacturer", "reg-other", parent=cls.sa)
            # A manufacturer's factory list is scoped by brand: each admin gets a brand of their own, as a registered admin does.
            cls.brand_keys = []
            for u in (cls.admin, cls.other_admin):
                key = f"rg{uuid.uuid4().hex[:8]}"
                self.db.add(AppBrand(key=key, name=key, short_name=key.upper(), status="ACTIVE", features={}))
                self.db.flush()
                u.brand_id = self.db.query(AppBrand.id).filter(AppBrand.key == key).scalar()
                cls.brand_keys.append(key)
            self.db.commit()

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(__import__("sqlalchemy").text("SET app.bypass_rls = 'on';"))
            for pid in cls.pumps:
                cls.db.query(AuditLog).filter(AuditLog.entity_id == pid).delete(synchronize_session=False)
            cls.db.execute(__import__("sqlalchemy").text("DELETE FROM agripump.allocation_logs WHERE pump_id = ANY(:ids)"), {"ids": cls.pumps}) if cls.pumps else None
            for bid in cls.batches:
                cls.db.query(BatchImei).filter(BatchImei.batch_id == bid).delete(synchronize_session=False)
            if cls.pumps:
                cls.db.execute(__import__("sqlalchemy").text("DELETE FROM agripump.device_configs WHERE pump_id = ANY(:ids)"), {"ids": cls.pumps})
                cls.db.query(Pump).filter(Pump.id.in_(cls.pumps)).delete(synchronize_session=False)
            for bid in cls.batches:
                cls.db.query(DeviceBatch).filter(DeviceBatch.id == bid).delete(synchronize_session=False)
            cls.db.commit()
        except Exception:
            cls.db.rollback()
        finally:
            super().tearDownClass()
            from app.database import SessionLocal

            db = SessionLocal()
            try:
                db.execute(__import__("sqlalchemy").text("SET app.bypass_rls = 'on';"))
                db.query(AppBrand).filter(AppBrand.key.in_(getattr(cls, "brand_keys", []))).delete(synchronize_session=False)
                db.commit()
            finally:
                db.close()

    def starter(self, creator=None, revoked=False, claimed=False, sid=None):
        sid = sid or f"AJ-T-{uuid.uuid4().hex[:8].upper()}"
        batch = DeviceBatch(id=uuid.uuid4(), batch_code=f"B-{uuid.uuid4().hex[:8]}", model="m", hw_rev="1", quantity=1,
                            created_by=(creator or self.admin).id, brand_id=(creator or self.admin).brand_id, revoked=revoked)
        self.db.add(batch)
        self.db.flush()
        row = BatchImei(batch_id=batch.id, mcu_uid=sid, claimed=claimed, hp_rating=5.0, supply_type="3-phase")
        self.db.add(row)
        self.db.commit()
        type(self).batches.append(batch.id)
        type(self).pumps.append(sid)
        return row

    def register(self, row, actor=None, iot=None, enabled=True):
        iot = iot or FakeIot()
        with patch("app.services.starter_registration.iot_client", return_value=iot), patch.object(settings, "STARTER_REGISTRATION", enabled):
            return client.post(f"{API}/batches/starters/{row.id}/register", headers=_h(actor or self.admin)), iot


class TestRegisteringOnScan(Base):
    def test_one_call_makes_the_pump_the_aws_identity_and_the_package(self):
        row = self.starter()
        r, iot = self.register(row)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.headers["content-type"], "application/zip")
        self.assertIn("no-store", r.headers["cache-control"])
        for needed in ("create_thing", "create_keys_and_certificate", "attach_policy", "attach_thing_principal"):
            self.assertIn(needed, iot.names())
        create = [kw for n, kw in iot.calls if n == "create_thing"][0]
        self.assertEqual(create["thingName"], row.mcu_uid, "the thing is named exactly like the barcode")
        attach = [kw for n, kw in iot.calls if n == "attach_policy"][0]
        self.assertEqual(attach["policyName"], settings.IOT_DEVICE_POLICY_NAME)

        z = zipfile.ZipFile(io.BytesIO(r.content))
        names = z.namelist()
        for f in ("certificate.pem.crt", "private.pem.key", "AmazonRootCA1.pem", "README.txt"):
            self.assertIn(f"{row.mcu_uid}/{f}", names)
        self.assertIn("SECRET", z.read(f"{row.mcu_uid}/private.pem.key").decode())
        self.assertIn("BEGIN CERTIFICATE", z.read(f"{row.mcu_uid}/AmazonRootCA1.pem").decode())

        self.db.expire_all()
        row = self.db.query(BatchImei).filter(BatchImei.id == row.id).one()
        self.assertTrue(row.claimed)
        self.assertEqual(row.pump_id, row.mcu_uid)

    def test_the_pump_is_stock_in_the_uploading_admins_tree(self):
        row = self.starter()
        r, _ = self.register(row)
        self.assertEqual(r.status_code, 200, r.text)
        self.db.expire_all()
        pump = self.db.query(Pump).filter(Pump.id == row.mcu_uid).one()
        self.assertEqual(pump.owner_user_id, self.admin.id)
        self.assertEqual(pump.hierarchy_path, self.admin.hierarchy_path)
        self.assertEqual(pump.lifecycle_state, "MANUFACTURED")
        self.assertEqual(float(pump.hp_rating), 5.0)

    def test_the_admin_can_then_register_a_farmer_on_that_starter(self):
        """The gap that blocked testing: the pump was out of the admin's sight and in a state a farmer could not be put on."""
        row = self.starter()
        r, _ = self.register(row)
        self.assertEqual(r.status_code, 200, r.text)
        phone = f"90{uuid.uuid4().int % 10**8:08d}"
        f = client.post(f"{API}/farmers", headers=_h(self.admin),
                        json={"full_name": "Ramesh Patil", "address": "Nashik, Maharashtra", "phone": phone, "starter_id": row.mcu_uid, "capacity_hp": 5})
        self.assertEqual(f.status_code, 201, f.text)
        self.db.expire_all()
        self.assertEqual(self.db.query(Pump).filter(Pump.id == row.mcu_uid).one().lifecycle_state, "ALLOCATED")
        farmer = self.db.query(User).filter(User.phone_number.like(f"%{phone[-10:]}")).first()
        if farmer is not None:
            self.db.execute(__import__("sqlalchemy").text("SET app.bypass_rls = 'on';"))
            type(self).user_ids.append(farmer.id)

    def test_it_is_written_to_the_audit_log_without_the_key(self):
        row = self.starter()
        r, _ = self.register(row)
        self.assertEqual(r.status_code, 200, r.text)
        self.db.expire_all()
        log = self.db.query(AuditLog).filter(AuditLog.entity_id == row.mcu_uid, AuditLog.action == "STARTER_REGISTERED_IN_AWS").one()
        self.assertEqual(log.actor_id, self.admin.id)
        self.assertEqual(log.after_json["certificate_id"], "abc123")
        self.assertNotIn("SECRET", str(log.after_json))


class TestTheRootCertificateTravelsWithTheCode(unittest.TestCase):
    def test_amazons_public_root_certificate_is_in_the_app_and_would_be_committed(self):
        """A .pem file is git-ignored (keys must never be committed), so this public one is kept under another name: the server needs it to build the package."""
        from app.services import starter_registration as sr

        self.assertFalse(sr.ROOT_CA_FILE.endswith(".pem"))
        text = open(sr.ROOT_CA_FILE, encoding="ascii").read()
        self.assertIn("BEGIN CERTIFICATE", text)
        self.assertNotIn("PRIVATE KEY", text)


class TestRefusals(Base):
    def test_a_second_registration_is_refused_and_makes_nothing(self):
        row = self.starter()
        self.assertEqual(self.register(row)[0].status_code, 200)
        r, iot = self.register(row)
        self.assertEqual(r.status_code, 409)
        self.assertIn("already registered", r.json()["detail"])
        self.assertNotIn("create_thing", iot.names())

    def test_a_revoked_batch_is_refused(self):
        r, iot = self.register(self.starter(revoked=True))
        self.assertEqual(r.status_code, 409)
        self.assertNotIn("create_thing", iot.names())

    def test_an_existing_aws_thing_is_never_touched(self):
        row = self.starter()
        r, iot = self.register(row, iot=FakeIot(thing_exists=True))
        self.assertEqual(r.status_code, 409)
        self.assertIn("already exists in AWS", r.json()["detail"])
        self.assertNotIn("create_thing", iot.names())
        self.db.expire_all()
        self.assertFalse(self.db.query(BatchImei).filter(BatchImei.id == row.id).one().claimed)

    def test_a_missing_device_policy_stops_before_anything_is_made(self):
        r, iot = self.register(self.starter(), iot=FakeIot(policy_exists=False))
        self.assertEqual(r.status_code, 502)
        self.assertNotIn("create_thing", iot.names())

    def test_only_the_owning_admins_factory_can_do_it(self):
        row = self.starter()
        r, iot = self.register(row, actor=self.other_admin)
        self.assertEqual(r.status_code, 404, "another manufacturer cannot even see the starter")
        self.assertNotIn("create_thing", iot.names())

    def test_a_farmer_or_a_dealer_cannot(self):
        row = self.starter()
        dealer = _partner(self, "dealer", "reg-dealer", parent=self.admin)
        r, _ = self.register(row, actor=dealer)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(client.post(f"{API}/batches/starters/{row.id}/register").status_code, 401)

    def test_switched_off_it_does_nothing(self):
        row = self.starter()
        r, iot = self.register(row, enabled=False)
        self.assertEqual(r.status_code, 503)
        self.assertEqual(iot.calls, [])


class TestNothingIsLeftHalfDone(Base):
    def test_when_aws_fails_midway_what_was_made_is_removed_and_the_starter_stays_unregistered(self):
        row = self.starter()
        iot = FakeIot(fail_at="attach_policy")
        r, iot = self.register(row, iot=iot)
        self.assertEqual(r.status_code, 502)
        names = iot.names()
        self.assertIn("delete_certificate", names)
        self.assertIn("delete_thing", names)
        self.db.expire_all()
        self.assertFalse(self.db.query(BatchImei).filter(BatchImei.id == row.id).one().claimed)
        self.assertIsNone(self.db.query(Pump).filter(Pump.id == row.mcu_uid).first(), "the pump row was not kept either")

    def test_the_private_key_is_not_in_the_error_text(self):
        iot = FakeIot(fail_at="attach_thing_principal")
        r, _ = self.register(self.starter(), iot=iot)
        self.assertNotIn("SECRET", r.text)


if __name__ == "__main__":
    unittest.main()
