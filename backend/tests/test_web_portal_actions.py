"""The partner-portal actions that had a button and no server behind them (FR-WEB-013, 031, 034, 035) and the warranty
editor, whose route existed but never saved anything.

Runs against the local development database, as the other portal tests do.
"""
import os
import sys
import threading
import unittest
import uuid
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.models import (
    AllocationLog, AuditLog, BatchImei, BridgeSwapLog, Command, DeviceBatch, InviteToken, McuSwapLog, Pump,
)
from app.models.user import User
from app.services.jwt_auth import hash_refresh_token, verify_secret
from test_web_portal_hardening import PASSWORD, MfaBase  # noqa: E402
from test_web_portal_users import _h, _partner, _verify_phone  # noqa: E402

client = TestClient(app)


def _phone():
    return f"90{uuid.uuid4().int % 10**8:08d}"


def _imei():
    return f"{uuid.uuid4().int % 10**15:015d}"


class Tree(MfaBase):
    """superadmin > dealer (> sub-dealer, > farmer), and a second dealer beside it that must stay out of reach."""

    def setUp(self):
        cls = type(self)
        if getattr(cls, "sa", None) is None:
            cls.sa = _partner(self, "superadmin", "root")
        self.dealer = _partner(self, "dealer", "d1", parent=self.sa)
        self.sub = _partner(self, "dealer", "d1-sub", parent=self.dealer)
        self.farmer = _partner(self, "customer", "farmer", parent=self.dealer)
        self.other = _partner(self, "dealer", "d10", parent=self.sa)
        self.other_farmer = _partner(self, "customer", "farmer10", parent=self.other)

    def pump(self, owner, state="ACTIVE", **extra):
        p = Pump(id=f"T{self.sfx}-{uuid.uuid4().hex[:8]}", name="Test pump", owner_user_id=owner.id,
                 hierarchy_path=owner.hierarchy_path, lifecycle_state=state, **extra)
        self.db.add(p)
        self.db.commit()
        return p.id

    def scalar(self, sql, **params):
        return self.db.execute(text(sql), params).scalar()

    def track(self, user_id):
        type(self).user_ids.append(uuid.UUID(str(user_id)))


class TestPartnerInvites(Tree):
    def invite(self, actor, **body):
        return client.post("/api/v1/invites", json=body, headers=_h(actor))

    def redeem(self, token, **body):
        body.setdefault("full_name", "New Partner")
        body.setdefault("phone_number", _phone())
        body.setdefault("password", "Strong-Pass-1")
        if "phone_verification_token" not in body:
            body["phone_verification_token"] = _verify_phone(body["phone_number"])
        r = client.post(f"/api/v1/invites/{token}/redeem", json=body)
        if r.status_code == 200:
            self.track(r.json()["user"]["id"])
        return r

    def test_only_a_partner_can_make_a_link_and_only_for_a_role_below_its_own(self):
        self.assertEqual(client.post("/api/v1/invites", json={"role": "dealer"}).status_code, 401)
        self.assertEqual(self.invite(self.farmer, role="dealer").status_code, 403)
        self.assertEqual(self.invite(self.dealer, role="distributor").status_code, 403)
        self.assertEqual(self.invite(self.dealer, role="superadmin").status_code, 403)
        ok = self.invite(self.dealer, role="dealer")
        self.assertEqual(ok.status_code, 200, ok.text)
        body = ok.json()
        self.assertEqual(body["role"], "dealer")
        self.assertTrue(len(body["token"]) >= 40)
        # A browser must not read the time as local time.
        self.assertTrue(body["expires_at"].endswith("+00:00"), body["expires_at"])

    def test_only_the_hash_of_the_link_is_kept(self):
        token = self.invite(self.dealer, role="customer").json()["token"]
        self.assertIsNone(self.db.query(InviteToken).filter(InviteToken.token_hash == token).first())
        self.assertIsNotNone(self.db.query(InviteToken).filter(InviteToken.token_hash == hash_refresh_token(token)).first())

    def test_the_parent_must_be_inside_the_callers_tree_and_able_to_host_that_role(self):
        self.assertEqual(self.invite(self.dealer, role="customer", parent_user_id=str(self.other.id)).status_code, 404)
        self.assertEqual(self.invite(self.dealer, role="customer", parent_user_id="not-a-uuid").status_code, 422)
        # A farmer cannot host anyone, and a sub-dealer cannot host a role above a dealer.
        self.assertEqual(self.invite(self.dealer, role="customer", parent_user_id=str(self.farmer.id)).status_code, 422)
        under_sub = self.invite(self.dealer, role="customer", parent_user_id=str(self.sub.id))
        self.assertEqual(under_sub.status_code, 200, under_sub.text)

    def test_redeeming_creates_the_account_under_the_parent_and_signs_it_in(self):
        token = self.invite(self.dealer, role="dealer", parent_user_id=str(self.sub.id)).json()["token"]
        digits = _phone()
        r = self.redeem(token, phone_number=f"+91 {digits[:5]}-{digits[5:]}")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["access_token"] and body["refresh_token"])
        self.assertFalse(body["mfa_setup_required"], "a dealer does not need an authenticator app")
        made = self.db.query(User).filter(User.id == body["user"]["id"]).one()
        self.assertEqual(made.role, "dealer")
        self.assertEqual(made.phone_number, f"+91{digits}")
        self.assertEqual(made.parent_user_id, self.sub.id)
        self.assertEqual(made.hierarchy_path, f"{self.sub.hierarchy_path}/{made.id}")
        self.assertEqual(made.dealer_depth, self.sub.dealer_depth + 1)
        # The password they chose works, and the session they were handed works.
        login = client.post("/api/v1/auth/login-password", json={"phone_number": made.phone_number, "password": "Strong-Pass-1"})
        self.assertEqual(login.status_code, 200, login.text)
        self.assertEqual(client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}).status_code, 200)
        audit = self.db.query(AuditLog).filter(AuditLog.entity_id == str(made.id), AuditLog.action == "USER_CREATED").first()
        self.assertIsNotNone(audit)

    def test_the_sign_up_page_can_ask_who_invited_you_and_whether_a_password_is_needed(self):
        dealer_link = self.invite(self.dealer, role="dealer").json()["token"]
        info = client.get(f"/api/v1/invites/{dealer_link}")
        self.assertEqual(info.status_code, 200, info.text)
        self.assertEqual(
            (info.json()["role"], info.json()["invited_by"], info.json()["password_required"]),
            ("dealer", self.dealer.full_name, True))
        farmer_link = self.invite(self.dealer, role="customer").json()["token"]
        self.assertFalse(client.get(f"/api/v1/invites/{farmer_link}").json()["password_required"])
        # Looking is not using: the link still works, and the preview leaks nothing else.
        self.assertEqual(set(info.json()), {"role", "invited_by", "expires_at", "password_required"})
        self.assertEqual(self.redeem(dealer_link).status_code, 200)
        self.assertEqual(client.get(f"/api/v1/invites/{dealer_link}").status_code, 404, "a used link is gone")
        self.assertEqual(client.get("/api/v1/invites/" + "z" * 43).status_code, 404)

    def test_a_link_works_once_and_every_bad_link_gets_the_same_answer(self):
        token = self.invite(self.dealer, role="customer").json()["token"]
        self.assertEqual(self.redeem(token).status_code, 200)
        used = self.redeem(token)
        unknown = self.redeem("x" * 43)
        self.assertEqual((used.status_code, unknown.status_code), (404, 404))
        self.assertEqual(used.json()["detail"], unknown.json()["detail"])

        expired = self.invite(self.dealer, role="customer").json()["token"]
        self.db.query(InviteToken).filter(InviteToken.token_hash == hash_refresh_token(expired)).update(
            {"expires_at": datetime.utcnow() - timedelta(minutes=1)})
        self.db.commit()
        self.assertEqual(self.redeem(expired).status_code, 404)

    def test_a_farmer_needs_no_password_but_a_partner_does(self):
        farmer_link = self.invite(self.dealer, role="customer").json()["token"]
        r = self.redeem(farmer_link, password=None)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIsNone(self.db.query(User).filter(User.id == r.json()["user"]["id"]).one().password_hash)

        dealer_link = self.invite(self.dealer, role="dealer").json()["token"]
        for pw in (None, "short"):
            self.assertEqual(self.redeem(dealer_link, password=pw).status_code, 422)

    def test_a_mistake_does_not_use_the_link_up(self):
        token = self.invite(self.dealer, role="dealer").json()["token"]
        taken = self.farmer.phone
        self.assertEqual(self.redeem(token, phone_number=taken).status_code, 409)
        self.assertEqual(self.redeem(token, phone_number="12345").status_code, 422)
        self.assertEqual(self.redeem(token, full_name="   ").status_code, 422)
        self.assertEqual(self.redeem(token, password="short").status_code, 422)
        self.assertEqual(self.redeem(token).status_code, 200, "after the mistakes the link still works")

    def test_the_same_number_in_another_format_is_still_taken(self):
        token = self.invite(self.dealer, role="customer").json()["token"]
        digits = self.farmer.phone[-10:]
        self.assertEqual(self.redeem(token, phone_number=digits).status_code, 409)

    def test_two_people_opening_one_link_at_once_get_one_account(self):
        token = self.invite(self.dealer, role="customer").json()["token"]
        results = []
        # Each racer's own phone, verified up front - the race is over the invite token's single use, not
        # over phone verification.
        phones = [_phone(), _phone()]
        tickets = [_verify_phone(p) for p in phones]

        def go(i):
            results.append(TestClient(app).post(
                f"/api/v1/invites/{token}/redeem",
                json={"full_name": "Racer", "phone_number": phones[i], "password": "Strong-Pass-1",
                      "phone_verification_token": tickets[i]}))

        threads = [threading.Thread(target=go, args=(i,)) for i in range(2)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        for r in results:
            if r.status_code == 200:
                self.track(r.json()["user"]["id"])
        self.assertEqual(sorted(r.status_code for r in results), [200, 404])

    def test_a_link_dies_with_the_account_that_made_it(self):
        token = self.invite(self.sub, role="customer").json()["token"]
        self.db.query(User).filter(User.id == self.sub.id).update({"account_status": "SUSPENDED"})
        self.db.commit()
        self.assertEqual(self.redeem(token).status_code, 404)

    def test_the_dealer_depth_limit_is_enforced_when_the_link_is_made(self):
        self.db.query(User).filter(User.id == self.sub.id).update({"dealer_depth": 6})
        self.db.commit()
        r = self.invite(self.sub, role="dealer")
        self.assertEqual(r.status_code, 422, r.text)


class TestPanelBinding(Tree):
    def put(self, actor, pump_id, **body):
        return client.put(f"/api/v1/pumps/{pump_id}/panel", json=body, headers=_h(actor))

    def test_a_partner_binds_and_the_values_are_saved(self):
        pid = self.pump(self.farmer)
        serial = f"SN-{uuid.uuid4().hex[:8]}"
        r = self.put(self.dealer, pid, panel_serial=f"  {serial} ", motor_rating="5 HP", starter_type="DOL",
                     pump_make="Crompton", pump_model="")
        self.assertEqual(r.status_code, 200, r.text)
        pump = r.json()["pump"]
        self.assertEqual((pump["panel_serial"], pump["motor_rating"], pump["pump_model"]), (serial, "5 HP", None))
        self.assertEqual(self.scalar("select panel_serial from agripump.pumps where id = :p", p=pid), serial)
        self.assertIsNotNone(self.db.query(AuditLog).filter(AuditLog.entity_id == pid, AuditLog.action == "PANEL_BOUND").first())

    def test_a_field_left_out_is_kept_and_an_explicit_null_clears_it(self):
        pid = self.pump(self.farmer)
        self.put(self.dealer, pid, panel_serial=f"SN-{uuid.uuid4().hex[:8]}", motor_rating="7.5 HP")
        r = self.put(self.dealer, pid, starter_type="Star-Delta")
        self.assertEqual(r.json()["pump"]["motor_rating"], "7.5 HP")
        r = self.put(self.dealer, pid, motor_rating=None)
        self.assertIsNone(r.json()["pump"]["motor_rating"])
        self.assertEqual(r.json()["pump"]["starter_type"], "Star-Delta")

    def test_one_panel_serial_cannot_sit_on_two_devices_even_across_partners(self):
        serial = f"SN-{uuid.uuid4().hex[:8]}"
        mine, theirs = self.pump(self.farmer), self.pump(self.other_farmer)
        self.assertEqual(self.put(self.dealer, mine, panel_serial=serial).status_code, 200)
        clash = self.put(self.other, theirs, panel_serial=serial)
        self.assertEqual(clash.status_code, 409, clash.text)
        self.assertNotIn(mine, clash.text, "must not reveal which device already has it")

    def test_who_may_bind(self):
        pid = self.pump(self.farmer)
        self.assertEqual(client.put(f"/api/v1/pumps/{pid}/panel", json={"panel_serial": "X"}).status_code, 401)
        self.assertEqual(self.put(self.farmer, pid, panel_serial="X1").status_code, 403)
        self.assertEqual(self.put(self.other, pid, panel_serial="X2").status_code, 404)
        self.assertEqual(self.put(self.dealer, "no-such-pump", panel_serial="X3").status_code, 404)
        self.assertEqual(self.put(self.sa, pid, panel_serial=f"SN-{uuid.uuid4().hex[:8]}").status_code, 200)


class TestMcuSwap(Tree):
    def swap(self, actor, pump_id, **body):
        return client.post(f"/api/v1/pumps/{pump_id}/mcu-swap", json=body, headers=_h(actor))

    def history(self, actor, pump_id):
        return client.get(f"/api/v1/pumps/{pump_id}/mcu-swap-history", headers=_h(actor))

    def test_history_starts_empty_and_records_who_swapped_what(self):
        pid = self.pump(self.farmer)
        empty = self.history(self.dealer, pid).json()
        self.assertEqual(empty, {"current_mcu_uid": None, "history": []})

        first = self.swap(self.dealer, pid, new_mcu_uid="abcd-1234", reason="Burnt input stage")
        self.assertEqual(first.status_code, 201, first.text)
        self.assertIsNone(first.json()["swap"]["old_mcu_uid"])
        second = self.swap(self.dealer, pid, new_mcu_uid="EF56-7890")
        self.assertEqual(second.json()["swap"]["old_mcu_uid"], "ABCD-1234")

        h = self.history(self.dealer, pid).json()
        self.assertEqual(h["current_mcu_uid"], "EF56-7890")
        self.assertEqual([e["new_mcu_uid"] for e in h["history"]], ["EF56-7890", "ABCD-1234"])
        self.assertEqual(h["history"][1]["reason"], "Burnt input stage")
        self.assertEqual(h["history"][0]["performed_by_name"], self.dealer.full_name)
        for entry in h["history"]:
            when = datetime.fromisoformat(entry["occurred_at"])      # what a browser has to be able to read
            self.assertIsNotNone(when.utcoffset(), "the time says which zone it is in")
            self.assertLess(abs(datetime.now(timezone.utc) - when), timedelta(minutes=5))
        self.assertIsNotNone(datetime.fromisoformat(first.json()["swap"]["occurred_at"]).utcoffset())

    def test_bad_input_and_repeats_are_refused(self):
        pid = self.pump(self.farmer)
        self.assertEqual(self.swap(self.dealer, pid, new_mcu_uid="ab").status_code, 422)
        self.assertEqual(self.swap(self.dealer, pid, new_mcu_uid="has space!").status_code, 422)
        self.assertEqual(self.swap(self.dealer, pid, new_mcu_uid="AAAA1111").status_code, 201)
        self.assertEqual(self.swap(self.dealer, pid, new_mcu_uid="aaaa1111").status_code, 409)

    def test_a_retired_device_is_left_alone(self):
        pid = self.pump(self.farmer, state="RETIRED")
        self.assertEqual(self.swap(self.dealer, pid, new_mcu_uid="AAAA1111").status_code, 409)

    def test_who_may_use_it(self):
        pid = self.pump(self.farmer)
        self.assertEqual(client.get(f"/api/v1/pumps/{pid}/mcu-swap-history").status_code, 401)
        for call in (self.swap(self.farmer, pid, new_mcu_uid="AAAA1111"), self.history(self.farmer, pid)):
            self.assertEqual(call.status_code, 403)
        for call in (self.swap(self.other, pid, new_mcu_uid="AAAA1111"), self.history(self.other, pid)):
            self.assertEqual(call.status_code, 404)


class TestBridgeSwap(Tree):
    def swap(self, actor, pump_id, **body):
        return client.post(f"/api/v1/pumps/{pump_id}/bridge-swap", json=body, headers=_h(actor))

    def seed(self, pid):
        """One row of every kind that points at a pump."""
        d, u = self.db, self.farmer.id
        soon = datetime.utcnow() + timedelta(seconds=120)
        d.add(Command(cid=uuid.uuid4(), pump_id=pid, action="START", status="QUEUED", expires_at=soon))
        d.add(Command(cid=uuid.uuid4(), pump_id=pid, action="STOP", status="APPLIED", expires_at=soon))
        for sql in (
            "insert into agripump.telemetry_history (pump_id) values (:p)",
            "insert into agripump.fault_logs (pump_id, description) values (:p, 'test')",
            "insert into agripump.daily_summary (device_id, day) values (:p, current_date)",
            "insert into agripump.alert_subscriptions (user_id, pump_id) values (:u, :p)",
            "insert into agripump.device_access (user_id, device_id) values (:u, :p)",
            "insert into agripump.allocation_log (pump_id, to_user_id) values (:p, :u)",
            "insert into agripump.alerts (pump_id, alert_type, severity, dedup_bucket) values (:p, 'FAULT', 'HIGH', 1)",
            "insert into agripump.panels (panel_serial, pump_id) values (:s, :p)",
            "insert into agripump.invites (token, parent_user_id, role, expires_at, device_id) "
            "values (:t, :u, 'viewer', now() + interval '1 day', :p)",
        ):
            d.execute(text(sql), {"p": pid, "u": u, "s": f"S-{uuid.uuid4().hex[:8]}", "t": uuid.uuid4().hex})
        d.commit()

    def test_the_whole_history_moves_to_the_new_identity(self):
        old = self.pump(self.farmer, firmware_version="1.2.3", supports_command_ack=True)
        self.seed(old)
        old_key_hash = self.scalar("select device_key_hash from agripump.pumps where id = :p", p=old)
        new = _imei()

        r = self.swap(self.sa, old, new_imei=new, reason="  Water damage  ")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["new_pump_id"], new)
        self.assertEqual(body["swap"]["reason"], "Water damage")
        self.assertIsNotNone(datetime.fromisoformat(body["swap"]["occurred_at"]).utcoffset())

        self.assertEqual(self.scalar("select count(*) from agripump.pumps where id = :p", p=old), 0)
        self.assertEqual(self.scalar("select count(*) from agripump.pumps where id = :p", p=new), 1)
        for table, column in (
            ("telemetry_history", "pump_id"), ("fault_logs", "pump_id"), ("daily_summary", "device_id"),
            ("alert_subscriptions", "pump_id"), ("device_access", "device_id"), ("allocation_log", "pump_id"),
            ("alerts", "pump_id"), ("panels", "pump_id"), ("invites", "device_id"), ("commands", "pump_id"),
            ("device_config", "pump_id"),
        ):
            moved = self.scalar(f"select count(*) from agripump.{table} where {column} = :p", p=new)
            left = self.scalar(f"select count(*) from agripump.{table} where {column} = :p", p=old)
            if table != "device_config":       # the test pump was created without one
                self.assertGreaterEqual(moved, 1, f"{table} did not follow the pump")
            self.assertEqual(left, 0, f"{table} still points at the old id")

        # What was still on its way to the old device must not reach the new one; what had finished stays as it was.
        cmds = {c.action: c for c in self.db.query(Command).filter(Command.pump_id == new).all()}
        self.assertEqual((cmds["START"].status, cmds["START"].failure_reason), ("FAILED", "device_replaced"))
        self.assertEqual(cmds["STOP"].status, "APPLIED")

        # A new device key, shown once and stored only as a hash; nothing about the old hardware is carried over.
        row = self.db.execute(text("select device_key_hash, supports_command_ack, firmware_version from agripump.pumps where id = :p"), {"p": new}).one()
        self.assertTrue(verify_secret(body["device_key"], row[0]))
        self.assertNotEqual(row[0], old_key_hash)
        self.assertEqual((row[1], row[2]), (False, None))

        log = self.db.query(BridgeSwapLog).filter(BridgeSwapLog.new_pump_id == new).one()
        self.assertEqual((log.old_pump_id, log.performed_by), (old, self.sa.id))
        self.assertIsNotNone(self.db.query(AuditLog).filter(AuditLog.entity_id == new, AuditLog.action == "BRIDGE_SWAPPED").first())
        # The old id is gone for good.
        self.assertEqual(client.get(f"/api/v1/pumps/{old}", headers=_h(self.sa)).status_code, 404)
        self.assertEqual(client.get(f"/api/v1/pumps/{new}", headers=_h(self.sa)).status_code, 200)

    def test_refusals(self):
        pid = self.pump(self.farmer)
        taken = self.pump(self.farmer)
        for bad in ("12345", "12345678901234a", "1234567890123456", ""):
            self.assertEqual(self.swap(self.sa, pid, new_imei=bad).status_code, 422, bad)
        self.assertEqual(self.swap(self.sa, pid, new_imei=taken).status_code, 422, "an existing id that is not an IMEI")
        self.assertEqual(self.swap(self.sa, "no-such-pump", new_imei=_imei()).status_code, 404)
        retired = self.pump(self.farmer, state="RETIRED")
        self.assertEqual(self.swap(self.sa, retired, new_imei=_imei()).status_code, 409)
        # The new identity may not already exist.
        existing = _imei()
        self.db.add(Pump(id=existing, name="Existing", owner_user_id=self.farmer.id, hierarchy_path=self.farmer.hierarchy_path))
        self.db.commit()
        self.assertEqual(self.swap(self.sa, pid, new_imei=existing).status_code, 409)
        self.assertEqual(self.scalar("select count(*) from agripump.pumps where id = :p", p=pid), 1, "nothing changed")

    def test_only_the_platform_owner_may_do_it(self):
        pid = self.pump(self.farmer)
        self.assertEqual(client.post(f"/api/v1/pumps/{pid}/bridge-swap", json={"new_imei": _imei()}).status_code, 401)
        for actor in (self.dealer, self.farmer):
            self.assertEqual(self.swap(actor, pid, new_imei=_imei()).status_code, 403)
        self.assertEqual(self.scalar("select count(*) from agripump.pumps where id = :p", p=pid), 1)


class TestBulkAllocate(Tree):
    def allocate(self, actor, ids, to, **extra):
        return client.post("/api/v1/pumps/bulk-allocate", json={"pump_ids": ids, "to_user_id": str(to.id), **extra}, headers=_h(actor))

    def row(self, pid):
        return self.db.execute(text("select owner_user_id, hierarchy_path, lifecycle_state, org_id from agripump.pumps where id = :p"), {"p": pid}).one()

    def test_stock_devices_move_to_the_target_and_each_move_is_recorded(self):
        fresh, in_stock, allocated = (self.pump(self.dealer, state=s) for s in ("MANUFACTURED", "IN_STOCK", "ALLOCATED"))
        r = self.allocate(self.dealer, [fresh, in_stock, allocated], self.sub, note="Q3 stock")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual([x["success"] for x in r.json()["results"]], [True, True, True])
        self.assertEqual(r.json()["message"], "3 of 3 devices allocated")
        for pid, state in ((fresh, "ALLOCATED"), (in_stock, "ALLOCATED"), (allocated, "ALLOCATED")):
            owner, path, lifecycle, org = self.row(pid)
            self.assertEqual((owner, path, lifecycle), (self.sub.id, self.sub.hierarchy_path, state))
        log = self.db.query(AllocationLog).filter(AllocationLog.pump_id == fresh).one()
        self.assertEqual((log.from_user_id, log.to_user_id, log.actor_id, log.note), (self.dealer.id, self.sub.id, self.dealer.id, "Q3 stock"))
        self.assertIsNotNone(self.db.query(AuditLog).filter(AuditLog.entity_id == fresh, AuditLog.action == "DEVICE_ALLOCATED").first())

    def test_each_device_succeeds_or_fails_on_its_own(self):
        stock = self.pump(self.dealer, state="IN_STOCK")
        live = self.pump(self.dealer, state="ACTIVE")
        already = self.pump(self.sub, state="IN_STOCK")
        foreign = self.pump(self.other, state="IN_STOCK")
        r = self.allocate(self.dealer, [stock, live, already, foreign, "no-such-pump", stock], self.sub)
        self.assertEqual(r.status_code, 200, r.text)
        by_id = {x["pump_id"]: x for x in r.json()["results"]}
        self.assertEqual(len(r.json()["results"]), 5, "a repeated id is handled once")
        self.assertTrue(by_id[stock]["success"])
        self.assertIn("active", by_id[live]["reason"])
        self.assertEqual(by_id[already]["reason"], "Already allocated to this account")
        self.assertFalse(by_id[foreign]["success"])
        self.assertFalse(by_id["no-such-pump"]["success"])
        self.assertEqual(self.row(live)[0], self.dealer.id, "a device in service is not moved")
        self.assertEqual(self.row(foreign)[0], self.other.id, "another partner's device is not touched")
        self.assertEqual(r.json()["message"], "1 of 5 devices allocated")

    def test_the_target_must_be_below_the_caller(self):
        pid = self.pump(self.dealer, state="IN_STOCK")
        for target in (self.other, self.dealer, self.sa):
            self.assertEqual(self.allocate(self.dealer, [pid], target).status_code, 404, target.role)
        self.assertEqual(self.allocate(self.dealer, [pid], self.other_farmer).status_code, 404)
        stranger = client.post("/api/v1/pumps/bulk-allocate", json={"pump_ids": [pid], "to_user_id": str(uuid.uuid4())}, headers=_h(self.dealer))
        self.assertEqual(stranger.status_code, 404)
        self.assertEqual(client.post("/api/v1/pumps/bulk-allocate", json={"pump_ids": [pid], "to_user_id": "nope"}, headers=_h(self.dealer)).status_code, 422)
        self.assertEqual(self.row(pid)[0], self.dealer.id)

    def test_a_suspended_account_cannot_receive_stock(self):
        pid = self.pump(self.dealer, state="IN_STOCK")
        self.db.query(User).filter(User.id == self.sub.id).update({"account_status": "SUSPENDED"})
        self.db.commit()
        self.assertEqual(self.allocate(self.dealer, [pid], self.sub).status_code, 404)

    def test_the_platform_owner_can_allocate_to_any_partner(self):
        pid = self.pump(self.other, state="IN_STOCK")
        r = self.allocate(self.sa, [pid], self.dealer)
        self.assertTrue(r.json()["results"][0]["success"], r.text)
        self.assertEqual(self.row(pid)[1], self.dealer.hierarchy_path)
        self.assertEqual(self.allocate(self.sa, [pid], self.sa).status_code, 404, "not to itself")

    def test_the_request_is_validated_and_needs_a_partner(self):
        pid = self.pump(self.dealer, state="IN_STOCK")
        self.assertEqual(client.post("/api/v1/pumps/bulk-allocate", json={"pump_ids": [pid], "to_user_id": str(self.sub.id)}).status_code, 401)
        self.assertEqual(self.allocate(self.farmer, [pid], self.sub).status_code, 403)
        self.assertEqual(self.allocate(self.dealer, [], self.sub).status_code, 422)
        self.assertEqual(self.allocate(self.dealer, [f"P{i}" for i in range(501)], self.sub).status_code, 422)


class TestWarranty(Tree):
    def put(self, actor, pump_id, **body):
        return client.put(f"/api/v1/pumps/{pump_id}/warranty", json=body, headers=_h(actor))

    def test_the_dates_the_portal_sends_are_saved(self):
        pid = self.pump(self.farmer)
        r = self.put(self.sa, pid, warranty_start_date="2026-03-01", warranty_period_months=24)
        self.assertEqual(r.status_code, 200, r.text)
        row = self.db.execute(text("select warranty_start_date, warranty_period_months from agripump.pumps where id = :p"), {"p": pid}).one()
        self.assertEqual((row[0], row[1]), (date(2026, 3, 1), 24))
        self.assertEqual(r.json()["warranty_start_date"], "2026-03-01")

        cleared = self.put(self.sa, pid, warranty_start_date=None, warranty_period_months=None)
        self.assertEqual(cleared.status_code, 200, cleared.text)
        row = self.db.execute(text("select warranty_start_date, warranty_period_months from agripump.pumps where id = :p"), {"p": pid}).one()
        self.assertEqual((row[0], row[1]), (None, None))
        self.assertIsNotNone(self.db.query(AuditLog).filter(AuditLog.entity_id == pid, AuditLog.action == "WARRANTY_UPDATED").first())

    def test_half_a_warranty_and_silly_periods_are_refused(self):
        pid = self.pump(self.farmer)
        self.assertEqual(self.put(self.sa, pid, warranty_start_date="2026-03-01").status_code, 422)
        self.assertEqual(self.put(self.sa, pid, warranty_period_months=12).status_code, 422)
        for months in (0, -3, 121):
            self.assertEqual(self.put(self.sa, pid, warranty_start_date="2026-03-01", warranty_period_months=months).status_code, 422, months)
        self.assertEqual(self.put(self.sa, pid, warranty_start_date="not-a-date", warranty_period_months=12).status_code, 422)

    def test_only_the_platform_owner_may_change_it(self):
        pid = self.pump(self.farmer)
        body = {"warranty_start_date": "2026-03-01", "warranty_period_months": 12}
        self.assertEqual(client.put(f"/api/v1/pumps/{pid}/warranty", json=body).status_code, 401)
        self.assertEqual(self.put(self.dealer, pid, **body).status_code, 403)
        self.assertEqual(self.put(self.sa, "no-such-pump", **body).status_code, 404)


class TestProvenance(Tree):
    """What the Ownership and Diagnostics tabs read. The tabs crashed on the old shape."""

    def get(self, actor, pump_id):
        return client.get(f"/api/v1/pumps/{pump_id}/provenance", headers=_h(actor))

    def test_a_hand_registered_device_has_an_owner_and_nothing_invented(self):
        pid = self.pump(self.farmer)
        body = self.get(self.dealer, pid).json()
        self.assertEqual(body["owner"]["id"], str(self.farmer.id))
        self.assertEqual((body["owner"]["role"], body["owner"]["full_name"]), ("customer", self.farmer.full_name))
        self.assertEqual((body["allocation_history"], body["warranty"], body["batch"]), ([], None, None))

    def test_the_allocation_history_names_everyone_and_the_newest_comes_first(self):
        pid = self.pump(self.dealer, state="IN_STOCK")
        client.post("/api/v1/pumps/bulk-allocate", json={"pump_ids": [pid], "to_user_id": str(self.sub.id), "note": "Stock"}, headers=_h(self.dealer))
        self.db.add(AllocationLog(pump_id=pid, from_user_id=self.sub.id, to_user_id=self.sa.id, actor_id=None, note="Recalled"))
        self.db.commit()
        history = self.get(self.sa, pid).json()["allocation_history"]
        self.assertEqual([h["note"] for h in history], ["Recalled", "Stock"])
        stock = history[1]
        self.assertEqual((stock["from_full_name"], stock["to_full_name"], stock["actor_full_name"]),
                         (self.dealer.full_name, self.sub.full_name, self.dealer.full_name))
        self.assertIsNone(history[0]["actor_full_name"], "an action by the system has no actor to name")
        self.assertIsNotNone(datetime.fromisoformat(stock["occurred_at"]).utcoffset())

    def test_warranty_end_date_and_expiry(self):
        pid = self.pump(self.farmer)
        client.put(f"/api/v1/pumps/{pid}/warranty", json={"warranty_start_date": "2020-01-31", "warranty_period_months": 25}, headers=_h(self.sa))
        old = self.get(self.dealer, pid).json()["warranty"]
        self.assertEqual((old["start_date"], old["end_date"], old["period_months"], old["expired"]), ("2020-01-31", "2022-02-28", 25, True))
        soon = (date.today() - timedelta(days=30)).isoformat()
        client.put(f"/api/v1/pumps/{pid}/warranty", json={"warranty_start_date": soon, "warranty_period_months": 12}, headers=_h(self.sa))
        self.assertFalse(self.get(self.dealer, pid).json()["warranty"]["expired"])

    def test_the_manufacturing_batch_shows_when_the_device_came_from_one(self):
        pid = self.pump(self.farmer)
        batch = DeviceBatch(batch_code=f"B-{self.sfx}-{uuid.uuid4().hex[:4]}", model="AGP-100", hw_rev="C2", quantity=1)
        self.db.add(batch)
        self.db.flush()
        imei = _imei()
        self.db.add(BatchImei(batch_id=batch.id, imei=imei, mcu_uid="A1B2C3D4E5F6", claimed=True, pump_id=pid, claimed_at=datetime.utcnow()))
        self.db.commit()
        try:
            got = self.get(self.dealer, pid).json()["batch"]
            self.assertEqual((got["imei"], got["mcu_uid"], got["batch_code"], got["model"], got["hw_rev"]),
                             (imei, "A1B2C3D4E5F6", batch.batch_code, "AGP-100", "C2"))
        finally:
            self.db.query(DeviceBatch).filter(DeviceBatch.id == batch.id).delete()
            self.db.commit()

    def test_only_partners_in_scope_may_read_it(self):
        pid = self.pump(self.farmer)
        self.assertEqual(client.get(f"/api/v1/pumps/{pid}/provenance").status_code, 401)
        self.assertEqual(self.get(self.farmer, pid).status_code, 403)
        self.assertEqual(self.get(self.other, pid).status_code, 404)
        self.assertEqual(self.get(self.dealer, "no-such-pump").status_code, 404)


if __name__ == "__main__":
    unittest.main()
