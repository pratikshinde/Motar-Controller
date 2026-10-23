"""CSV bulk import of devices (FR-WEB-010): it answered 500 for every file (the audit row used columns the table does not
have), invented a position and a firmware version for each device, and rejected a spreadsheet's UTF-8 file because of its
byte-order mark.

Runs against the local development database; every row created here is removed again.
"""
import os
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient

from app.main import app
from app.models import AuditLog, DeviceConfig, Pump
from test_web_portal_hardening import MfaBase  # noqa: E402
from test_web_portal_users import _h, _partner  # noqa: E402

client = TestClient(app)
HEADER = "serial,model,hw_rev,batch_id,manufacture_date,supply_type,hp_rating\n"


class TestBulkImport(MfaBase):
    def setUp(self):
        self.serials = []

    def tearDown(self):
        self.db.rollback()
        if self.serials:
            self.db.query(DeviceConfig).filter(DeviceConfig.pump_id.in_(self.serials)).delete(synchronize_session=False)
            self.db.query(Pump).filter(Pump.id.in_(self.serials)).delete(synchronize_session=False)
            self.db.commit()

    def serial(self):
        s = f"E2E-{uuid.uuid4().hex[:10].upper()}"
        self.serials.append(s)
        return s

    def upload(self, user, text, name="devices.csv", encoding="utf-8"):
        return client.post("/api/v1/pumps/bulk-import", headers=_h(user),
                           files={"file": (name, text.encode(encoding), "text/csv")})

    def test_importing_creates_devices_without_inventing_anything(self):
        sa = _partner(self, "superadmin", "importer")
        first, second = self.serial(), self.serial()
        body = HEADER + f"{first},M1,1.0,BATCH-9,2026-10-16,3P,7.5\n{second},M1,1.0,BATCH-9,2026-10-16,1P,\n"
        r = self.upload(sa, body)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()["imported_count"], r.json()["skipped_count"], r.json()["errors"]), (2, 0, []))

        self.db.expire_all()
        pump = self.db.query(Pump).filter(Pump.id == first).one()
        self.assertEqual((pump.lifecycle_state, float(pump.hp_rating), pump.supply_type), ("MANUFACTURED", 7.5, "3-phase"))
        self.assertIsNone(pump.latitude, "an imported device has no known position until it is installed")
        self.assertIsNone(pump.longitude)
        self.assertIsNone(pump.firmware_version, "the device reports its own firmware version")
        self.assertEqual(self.db.query(Pump).filter(Pump.id == second).one().supply_type, "1-phase")
        audit = self.db.query(AuditLog).filter(AuditLog.entity_id == first, AuditLog.action == "BULK_IMPORT_DEVICE").first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.after_json, {"batch_id": "BATCH-9"})

    def test_duplicates_and_bad_rows_are_reported_not_fatal(self):
        sa = _partner(self, "superadmin", "importer2")
        good, again = self.serial(), None
        body = HEADER + f"{good},M1,1.0,B,2026-10-16,3P,5\n{good},M1,1.0,B,2026-10-16,3P,5\n,M1,1.0,B,2026-10-16,3P,5\n{'X' * 51},M1,1.0,B,2026-10-16,3P,5\n"
        r = self.upload(sa, body)
        self.assertEqual(r.status_code, 200, r.text)
        out = r.json()
        self.assertEqual((out["imported_count"], out["skipped_count"]), (1, 1))
        self.assertEqual(len(out["errors"]), 2, out["errors"])

    def test_a_spreadsheet_export_with_a_byte_order_mark_is_read(self):
        sa = _partner(self, "superadmin", "importer3")
        serial = self.serial()
        r = self.upload(sa, "﻿" + HEADER + f"{serial},M1,1.0,B,2026-10-16,3P,5\n")
        self.assertEqual((r.status_code, r.json()["imported_count"], r.json()["errors"]), (200, 1, []), r.text)

    def test_only_the_right_kind_of_file_and_the_right_role_are_accepted(self):
        sa = _partner(self, "superadmin", "importer4")
        dealer = _partner(self, "dealer", "importer-dealer", parent=sa)
        self.assertEqual(self.upload(dealer, HEADER).status_code, 403)
        self.assertEqual(self.upload(sa, HEADER, name="devices.txt").status_code, 400)
        self.assertEqual(self.upload(sa, "serial\n\xff\xfe", encoding="latin-1").status_code, 400)
        self.assertEqual(client.post("/api/v1/pumps/bulk-import", files={"file": ("a.csv", b"serial\n", "text/csv")}).status_code, 401)


if __name__ == "__main__":
    unittest.main()
