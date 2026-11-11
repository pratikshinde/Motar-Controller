"""The starter sheet (Excel / CSV upload), the factory station (scan, look up, bench test), and who may use them.

Runs against the local development database; every user, batch, starter and pump created here is removed again.
"""
import io
import os
import sys
import unittest
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import text

from app.database import SessionLocal
from app.main import app
from app.models import BatchImei, DeviceBatch, Pump, User
from app.models.brand import AppBrand
from app.services import starter_sheet as ss
from app.services.jwt_auth import hash_secret, sign_token

client = TestClient(app)


def bearer(user):
    return {"Authorization": "Bearer " + sign_token({"sub": str(user.id), "role": user.role, "hierarchy_path": user.hierarchy_path, "session_ver": 1})}


class TestSheetParser(unittest.TestCase):
    def test_understands_the_columns_however_they_are_spelled(self):
        r = ss.parse_sheet("a.csv", b"Barcode;Modem IMEI;Capacity (HP);Phase;Mfg date\nX-1;861234567890123;7,5 HP;three phase;30-11-2026\n")
        [row] = r.rows
        self.assertEqual((row.starter_id, row.imei, row.hp_rating, row.supply_type, str(row.manufacture_date)), ("X-1", "861234567890123", 7.5, "3-phase", "2026-11-30"))
        self.assertEqual(r.errors, [])

    def test_excel_numbers_do_not_turn_into_scientific_notation_or_point_zero(self):
        wb = Workbook()
        ws = wb.active
        ws.append(["Starter ID", "IMEI", "HP"])
        ws.append([12345678, 861234567890123, 7.5])
        buf = io.BytesIO()
        wb.save(buf)
        [row] = ss.parse_sheet("a.xlsx", buf.getvalue()).rows
        self.assertEqual((row.starter_id, row.imei, row.hp_rating), ("12345678", "861234567890123", 7.5))

    def test_every_problem_is_listed_with_its_row_number_and_blank_rows_still_count(self):
        r = ss.parse_sheet("a.csv", b"Starter ID,IMEI,HP,Supply\nOK-1,,5,3P\n\nOK-1,,5,3P\nBAD ID,,5,3P\nOK-3,12345,5,3P\nOK-4,,abc,3P\nOK-5,,5,five\nOK-6,,5,3P,\n,,5,3P\n")
        self.assertEqual([(e["row"], e["starter_id"]) for e in r.errors], [(4, "OK-1"), (5, "BAD ID"), (6, "OK-3"), (7, "OK-4"), (8, "OK-5"), (10, "")])
        self.assertIn("row 2", r.errors[0]["reason"])
        self.assertEqual([x.starter_id for x in r.rows], ["OK-1", "OK-6"])

    def test_refuses_files_it_should_not_read(self):
        for name, data, part in (("a.xlsm", b"x", "macro"), ("a.xls", b"x", "macro"), ("a.pdf", b"x", "Excel"), ("a.xlsx", b"not a zip", "readable"),
                                 ("a.csv", b"", "empty"), ("a.csv", b"Name,Colour\nx,y\n", "Starter ID"), ("a.csv", b"x" * (ss.MAX_BYTES + 1), "larger")):
            with self.assertRaises(ss.SheetError, msg=name) as ctx:
                ss.parse_sheet(name, data)
            self.assertIn(part, str(ctx.exception))

    def test_the_template_is_a_valid_sheet_and_its_examples_are_marked(self):
        r = ss.parse_sheet("t.xlsx", ss.template_xlsx())
        self.assertEqual([x.starter_id for x in r.rows], ["EXAMPLE-0001", "EXAMPLE-0002"])
        self.assertTrue(all("delete it" in (x.notes or "") for x in r.rows))


class TestStarterApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))
        cls.sfx = uuid.uuid4().hex[:6]
        cls.num = str(uuid.uuid4().int)[:8]
        ajanta = cls.db.query(AppBrand).filter(AppBrand.key == "ajanta").one()
        other = cls.db.query(AppBrand).filter(AppBrand.key != "ajanta").first()
        cls.ajanta_id, cls.other_id = ajanta.id, other.id if other else None
        cls.users = []
        cls.maker = cls._user("manufacturer", brand_id=ajanta.id)
        cls.other_maker = cls._user("manufacturer", brand_id=cls.other_id) if cls.other_id else None
        cls.farmer = cls._user("customer")
        cls.sa = cls._user("superadmin")
        cls.h_maker, cls.h_farmer, cls.h_sa = bearer(cls.maker), bearer(cls.farmer), bearer(cls.sa)

    @classmethod
    def _user(cls, role, **kw):
        # A manufacturer sits at the top of the tree (/SA), as in the real system.
        path = "/SA" if role in ("manufacturer", "superadmin") else f"/t{uuid.uuid4().hex[:8]}"
        u = User(id=uuid.uuid4(), full_name=f"Sheet {role} {cls.sfx}", phone=f"+91{uuid.uuid4().int % 10**10:010d}", role=role, hierarchy_path=path,
                 account_status="ACTIVE", session_version=1, password_hash=hash_secret("Sheet-Test-9x"), **kw)
        cls.db.add(u)
        cls.db.commit()
        cls.users.append(u)
        return u

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            codes = [b.id for b in cls.db.query(DeviceBatch).filter(DeviceBatch.batch_code.like(f"%{cls.sfx}%")).all()]
            pump_ids = [r.pump_id for r in cls.db.query(BatchImei).filter(BatchImei.batch_id.in_(codes)).all() if r.pump_id]
            cls.db.query(BatchImei).filter(BatchImei.batch_id.in_(codes)).delete(synchronize_session=False)
            cls.db.query(Pump).filter(Pump.id.in_(pump_ids)).delete(synchronize_session=False)
            cls.db.query(DeviceBatch).filter(DeviceBatch.id.in_(codes)).delete(synchronize_session=False)
            cls.db.query(User).filter(User.id.in_([u.id for u in cls.users])).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            cls.db.close()

    # -- helpers --
    def setUp(self):
        # Every test gets its own starter IDs and IMEIs (a starter ID is unique across the whole list, and some tests claim or revoke).
        self.t = uuid.uuid4().hex[:5]
        self.imei1 = "861" + str(uuid.uuid4().int)[:11]

    def code(self, name):
        return f"{name}-{self.sfx}"

    def sid(self, n):
        return f"AJ-{self.sfx}{self.t}-{n}"

    def upload(self, headers, batch_code, content, filename="starters.csv", **form):
        return client.post("/api/v1/batches/starters/import", headers=headers, data={"batch_code": batch_code, **form}, files={"file": (filename, content)})

    def csv(self, *extra_rows):
        lines = ["Starter ID,IMEI,HP,Supply,Model,Notes", f"{self.sid(1)},{self.imei1},7.5,3P,PCD-1,first", f"{self.sid(2)},,5,1-phase,PCD-1,"]
        return ("\n".join(lines) + "\n").encode() + b"".join(extra_rows)

    def row_of(self, starter_id):
        self.db.expire_all()
        return self.db.query(BatchImei).filter(BatchImei.mcu_uid == starter_id).first()

    # -- who may use it --
    def test_a_farmer_may_not_touch_the_factory_list_at_all(self):
        for method, path in (("get", "/api/v1/batches"), ("get", "/api/v1/batches/starters/lookup?code=x"), ("get", "/api/v1/batches/starters/template.xlsx"),
                             ("post", "/api/v1/batches"), ("post", f"/api/v1/batches/{uuid.uuid4()}/revoke"), ("post", "/api/v1/batches/starters/1/test")):
            r = getattr(client, method)(path, headers=self.h_farmer)
            self.assertEqual(r.status_code, 403, f"{method} {path}: {r.text[:100]}")
        r = self.upload(self.h_farmer, self.code("F"), self.csv())
        self.assertEqual(r.status_code, 403)
        self.assertEqual(client.get("/api/v1/batches").status_code, 401)

    # -- the upload --
    def test_an_excel_or_csv_sheet_creates_the_batch_and_its_starters(self):
        r = self.upload(self.h_maker, self.code("B1"), self.csv(), model="PCD-A7672S")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual((body["saved"], body["created"], body["updated"], body["errors"]), (True, 2, 0, []))
        self.assertEqual(body["batch"]["batch_code"], self.code("B1"))
        row = self.row_of(self.sid(1))
        self.assertEqual((float(row.hp_rating), row.supply_type, row.model, row.notes), (7.5, "3-phase", "PCD-1", "first"))
        self.assertEqual(row.imei, self.imei1)
        batch = self.db.query(DeviceBatch).filter(DeviceBatch.id == row.batch_id).one()
        self.assertEqual((batch.brand_id, batch.created_by, batch.quantity), (self.ajanta_id, self.maker.id, 2))

        wb = Workbook()
        ws = wb.active
        ws.append(["Starter ID", "HP", "Supply"])
        ws.append([self.sid(11), 10, "3-phase"])
        buf = io.BytesIO()
        wb.save(buf)
        r = self.upload(self.h_maker, self.code("B2"), buf.getvalue(), filename="starters.xlsx")
        self.assertEqual((r.json()["saved"], r.json()["created"]), (True, 1), r.text)
        self.assertEqual(float(self.row_of(self.sid(11)).hp_rating), 10.0)

    def test_a_sheet_with_any_problem_saves_nothing_and_lists_every_problem(self):
        bad = self.csv(b"BAD ID,,5,3P\n")
        r = self.upload(self.h_maker, self.code("B3"), bad)
        body = r.json()
        self.assertFalse(body["saved"])
        self.assertEqual([e["row"] for e in body["errors"]], [4])
        self.assertIsNone(self.row_of(self.sid(1)) if False else self.db.query(DeviceBatch).filter(DeviceBatch.batch_code == self.code("B3")).first(), "not even the batch was made")

    def test_an_unreadable_file_is_a_clear_400(self):
        r = self.upload(self.h_maker, self.code("B4"), b"not a zip", filename="x.xlsx")
        self.assertEqual(r.status_code, 400)
        self.assertIn("readable", r.json()["detail"])

    def test_uploading_again_updates_what_changed_and_leaves_the_rest(self):
        self.upload(self.h_maker, self.code("B5"), self.csv())
        again = self.upload(self.h_maker, self.code("B5"), self.csv()).json()
        self.assertEqual((again["created"], again["updated"], again["unchanged"]), (0, 0, 2))
        changed = self.csv().replace(b",7.5,", b",9,")
        body = self.upload(self.h_maker, self.code("B5"), changed).json()
        self.assertEqual((body["created"], body["updated"], body["unchanged"]), (0, 1, 1))
        self.assertEqual(float(self.row_of(self.sid(1)).hp_rating), 9.0)

    def test_a_starter_that_belongs_to_another_batch_or_has_a_clashing_imei_is_refused(self):
        self.upload(self.h_maker, self.code("B6"), self.csv())
        clash = self.upload(self.h_maker, self.code("B7"), self.csv()).json()
        self.assertFalse(clash["saved"])
        self.assertIn("already on the list in batch", clash["errors"][0]["reason"])
        imei_clash = self.upload(self.h_maker, self.code("B8"), f"Starter ID,IMEI\nNEW-{self.sfx}{self.t},{self.imei1}\n".encode()).json()
        self.assertFalse(imei_clash["saved"])
        self.assertIn("IMEI", imei_clash["errors"][0]["reason"])

    def test_a_claimed_starter_can_no_longer_be_changed(self):
        self.upload(self.h_maker, self.code("B9"), self.csv())
        self.db.query(BatchImei).filter(BatchImei.mcu_uid == self.sid(1)).update({"claimed": True})
        self.db.commit()
        body = self.upload(self.h_maker, self.code("B9"), self.csv().replace(b",7.5,", b",9,")).json()
        self.assertFalse(body["saved"])
        self.assertIn("already claimed", body["errors"][0]["reason"])

    def test_a_revoked_batch_takes_no_more_starters(self):
        self.upload(self.h_maker, self.code("B10"), self.csv())
        batch = self.db.query(DeviceBatch).filter(DeviceBatch.batch_code == self.code("B10")).one()
        r = client.post(f"/api/v1/batches/{batch.id}/revoke", headers=self.h_maker)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.upload(self.h_maker, self.code("B10"), self.csv()).status_code, 409)

    def test_the_template_downloads_as_a_real_excel_file(self):
        r = client.get("/api/v1/batches/starters/template.xlsx", headers=self.h_maker)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.content.startswith(b"PK"))
        self.assertIn("spreadsheetml", r.headers["content-type"])

    # -- scoping --
    def test_a_manufacturer_sees_only_their_own_brands_batches(self):
        self.upload(self.h_maker, self.code("B11"), self.csv())
        mine = {b["batch_code"] for b in client.get("/api/v1/batches", headers=self.h_maker).json()["batches"]}
        self.assertIn(self.code("B11"), mine)
        if self.other_maker is None:
            self.skipTest("no second brand in this database")
        theirs = {b["batch_code"] for b in client.get("/api/v1/batches", headers=bearer(self.other_maker)).json()["batches"]}
        self.assertNotIn(self.code("B11"), theirs)
        self.assertEqual(client.get(f"/api/v1/batches/starters/lookup?code={self.sid(1)}", headers=bearer(self.other_maker)).status_code, 404)
        self.assertEqual(self.upload(bearer(self.other_maker), self.code("B11"), self.csv()).status_code, 409, "another brand cannot write into it")
        everyone = {b["batch_code"] for b in client.get("/api/v1/batches", headers=self.h_sa).json()["batches"]}
        self.assertIn(self.code("B11"), everyone)

    # -- the factory station --
    def test_scanning_a_barcode_finds_the_starters_row_and_how_far_along_it_is(self):
        self.upload(self.h_maker, self.code("B12"), self.csv(), model="PCD-A7672S")
        r = client.get(f"/api/v1/batches/starters/lookup?code={self.sid(1)}", headers=self.h_maker)
        self.assertEqual(r.status_code, 200, r.text)
        v = r.json()
        self.assertEqual((v["starter_id"], v["details"]["hp_rating"], v["details"]["supply_type"], v["details"]["model"]), (self.sid(1), 7.5, "3-phase", "PCD-1"))
        self.assertEqual({s["key"]: s["done"] for s in v["stages"]}, {"on_sheet": True, "tested": False, "claimed": False, "online": False, "farmer": False})
        by_imei = client.get(f"/api/v1/batches/starters/lookup?code={self.imei1}", headers=self.h_maker)
        self.assertEqual(by_imei.json()["starter_id"], self.sid(1), "the modem's IMEI finds it too")
        miss = client.get("/api/v1/batches/starters/lookup?code=NOT-THERE", headers=self.h_maker)
        self.assertEqual(miss.status_code, 404)
        self.assertIn("not on any uploaded sheet", miss.json()["detail"])

    def test_the_bench_test_is_recorded_and_can_be_redone(self):
        self.upload(self.h_maker, self.code("B13"), self.csv())
        row = self.row_of(self.sid(1))
        r = client.post(f"/api/v1/batches/starters/{row.id}/test", headers=self.h_maker, json={"result": "FAIL", "note": "relay clicks"})
        self.assertEqual(r.status_code, 200, r.text)
        v = r.json()
        self.assertEqual((v["test"]["result"], v["test"]["note"], v["test"]["tested_by"]), ("FAIL", "relay clicks", self.maker.full_name))
        self.assertTrue([s for s in v["stages"] if s["key"] == "tested"][0]["failed"])
        v = client.post(f"/api/v1/batches/starters/{row.id}/test", headers=self.h_maker, json={"result": "PASS"}).json()
        self.assertEqual(([s for s in v["stages"] if s["key"] == "tested"][0]["done"], v["test"]["note"]), (True, None))
        self.assertEqual(client.post(f"/api/v1/batches/starters/{row.id}/test", headers=self.h_maker, json={"result": "MAYBE"}).status_code, 422)
        self.assertEqual(client.post("/api/v1/batches/starters/99999999/test", headers=self.h_maker, json={"result": "PASS"}).status_code, 404)

    # -- the claim uses the sheet --
    def test_when_the_module_claims_its_certificate_the_pump_is_made_from_the_sheet(self):
        self.upload(self.h_maker, self.code("B14"), self.csv())
        r = client.post("/api/v1/batches/provisioning/pre-hook", json={"parameters": {"SerialNumber": self.sid(1)}})
        self.assertTrue(r.json()["allowProvisioning"], r.text)
        self.db.expire_all()
        pump = self.db.query(Pump).filter(Pump.id == self.sid(1)).one()
        self.assertEqual((float(pump.hp_rating), pump.supply_type, pump.lifecycle_state, pump.owner_user_id), (7.5, "3-phase", "COMMISSIONED", self.maker.id))
        v = client.get(f"/api/v1/batches/starters/lookup?code={self.sid(1)}", headers=self.h_maker).json()
        self.assertTrue([s for s in v["stages"] if s["key"] == "claimed"][0]["done"])
        self.assertEqual(v["pump"]["id"], self.sid(1))
        second = self.sid(2)
        pump2 = client.post("/api/v1/batches/provisioning/pre-hook", json={"parameters": {"SerialNumber": second}}).json()
        self.assertTrue(pump2["allowProvisioning"])
        self.db.expire_all()
        self.assertEqual((float(self.db.query(Pump).filter(Pump.id == second).one().hp_rating), self.db.query(Pump).filter(Pump.id == second).one().supply_type), (5.0, "1-phase"))


if __name__ == "__main__":
    unittest.main()
