"""Backend behaviour the farmer mobile app depends on.

Covers: per-user pump names / sites / order, sites CRUD, alert scoping, the remote-control guard for
suspended devices, timer limits, honest support contact, profile / session / export / deletion
endpoints, WebSocket scoping, and ingestion of cumulative run time.
"""
import asyncio
import json
import os
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.database import SessionLocal
from app.models import (
    AccountDeletionRequest, Alert, AuditLog, Command, DeviceAccess, DeviceConfig,
    FaultCodeCatalog, Pump, RefreshToken, Site, TelemetryHistory, User,
)
from app.services.jwt_auth import hash_secret, sign_token
from app.services.ws_hub import WebSocketHub
from app.workers.ingest import process_batch

client = TestClient(app)
PASSWORD = "Farmer-Test-9x"


def _bearer(user: User) -> dict:
    token = sign_token({"sub": str(user.id), "role": user.role, "hierarchy_path": user.hierarchy_path, "session_ver": 1})
    return {"Authorization": f"Bearer {token}"}


class FarmerAppBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))
        cls.sfx = uuid.uuid4().hex[:6]
        cls.pump_ids = []
        cls.users = []
        cls.a = cls._user("A")
        cls.b = cls._user("B")
        cls.pa1 = cls._pump("A1", cls.a)
        cls.pa2 = cls._pump("A2", cls.a)
        cls.pb = cls._pump("B1", cls.b)
        cls.ha, cls.hb = _bearer(cls.a), _bearer(cls.b)

    @classmethod
    def _user(cls, tag):
        u = User(
            id=uuid.uuid4(), full_name=f"Farmer {tag} {cls.sfx}", phone=f"+91{uuid.uuid4().int % 10**10:010d}",
            role="customer", hierarchy_path=f"/customers/{uuid.uuid4()}", account_status="ACTIVE", session_version=1,
            password_hash=hash_secret(PASSWORD),
        )
        cls.db.add(u)
        cls.db.commit()
        cls.users.append(u)
        return u

    @classmethod
    def _pump(cls, tag, owner, **kw):
        pid = f"PUMP-FA-{tag}-{cls.sfx}"
        p = Pump(id=pid, name=f"Pump {tag}", supply_type="3-phase", hp_rating=7.5, owner_user_id=owner.id,
                 hierarchy_path="/SA", status="STOPPED", lifecycle_state="ACTIVE", **kw)
        cls.db.add(p)
        cls.db.commit()
        cls.pump_ids.append(pid)
        return p

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            ids = cls.pump_ids
            uids = [u.id for u in cls.users]
            cls.db.query(Alert).filter(Alert.pump_id.in_(ids)).delete(synchronize_session=False)
            cls.db.query(Command).filter(Command.pump_id.in_(ids)).delete(synchronize_session=False)
            cls.db.query(DeviceConfig).filter(DeviceConfig.pump_id.in_(ids)).delete(synchronize_session=False)
            cls.db.query(TelemetryHistory).filter(TelemetryHistory.pump_id.in_(ids)).delete(synchronize_session=False)
            cls.db.query(DeviceAccess).filter(DeviceAccess.device_id.in_(ids)).delete(synchronize_session=False)
            cls.db.query(Pump).filter(Pump.id.in_(ids)).delete(synchronize_session=False)
            cls.db.query(Site).filter(Site.owner_user_id.in_(uids)).delete(synchronize_session=False)
            cls.db.query(AccountDeletionRequest).filter(AccountDeletionRequest.user_id.in_(uids)).delete(synchronize_session=False)
            cls.db.query(RefreshToken).filter(RefreshToken.user_id.in_(uids)).delete(synchronize_session=False)
            # audit_log is append-only for updates; the user FK is ON DELETE SET NULL / cascade by design.
            cls.db.query(User).filter(User.id.in_(uids)).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            cls.db.close()


class TestPumpViews(FarmerAppBase):
    def test_list_uses_own_nickname_site_and_order(self):
        s = client.post("/api/v1/sites", json={"name": f"North {self.sfx}"}, headers=self.ha)
        self.assertEqual(s.status_code, 201, s.text)
        site_id = s.json()["id"]

        r = client.patch(f"/api/v1/pumps/{self.pa1.id}/my-settings",
                         json={"nickname": "  Borewell  ", "site_id": site_id, "sort_order": 2}, headers=self.ha)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["nickname"], "Borewell")
        r = client.patch(f"/api/v1/pumps/{self.pa2.id}/my-settings", json={"sort_order": 1}, headers=self.ha)
        self.assertEqual(r.status_code, 200, r.text)

        lst = client.get("/api/v1/pumps", headers=self.ha).json()["pumps"]
        self.assertEqual([p["id"] for p in lst], [self.pa2.id, self.pa1.id], "sorted by the farmer's own order")
        first = {p["id"]: p for p in lst}
        self.assertEqual(first[self.pa1.id]["display_name"], "Borewell")
        self.assertEqual(first[self.pa1.id]["site_name"], f"North {self.sfx}")
        self.assertEqual(first[self.pa2.id]["display_name"], "Pump A2", "falls back to the pump's own name")
        self.assertIsNone(first[self.pa2.id]["nickname"])

    def test_other_farmers_pump_is_invisible(self):
        ids = [p["id"] for p in client.get("/api/v1/pumps", headers=self.ha).json()["pumps"]]
        self.assertNotIn(self.pb.id, ids)
        self.assertEqual(client.get(f"/api/v1/pumps/{self.pb.id}", headers=self.ha).status_code, 404)

    def test_site_of_another_farmer_is_rejected(self):
        theirs = client.post("/api/v1/sites", json={"name": f"Theirs {self.sfx}"}, headers=self.hb).json()["id"]
        r = client.patch(f"/api/v1/pumps/{self.pa1.id}/my-settings", json={"site_id": theirs}, headers=self.ha)
        self.assertEqual(r.status_code, 404)

    def test_runtime_and_subscription_fields(self):
        self.pa2.total_runtime_min = 12345
        self.pa2.subscription_expires_at = datetime.now(timezone.utc) + timedelta(days=5, hours=3)
        self.db.commit()
        p = client.get(f"/api/v1/pumps/{self.pa2.id}", headers=self.ha).json()["pump"]
        self.assertEqual(p["total_runtime_min"], 12345)
        self.assertEqual(p["subscription_days_left"], 5)
        self.assertIsNotNone(p["subscription_expires_at"])

    def test_support_contact_never_invented(self):
        c = client.get(f"/api/v1/pumps/{self.pa1.id}/support-contact", headers=self.ha)
        self.assertEqual(c.status_code, 200, c.text)
        body = c.json()
        self.assertIsNone(body["dealer_phone"])
        self.assertIsNone(body["dealer_name"])
        self.assertNotIn("Authorized AgriPump Dealer", json.dumps(body))


class TestSites(FarmerAppBase):
    def test_crud_and_isolation(self):
        name = f"Farm {self.sfx}"
        made = client.post("/api/v1/sites", json={"name": name}, headers=self.ha)
        self.assertEqual(made.status_code, 201)
        sid = made.json()["id"]

        dup = client.post("/api/v1/sites", json={"name": name.upper()}, headers=self.ha)
        self.assertEqual(dup.status_code, 409)
        self.assertEqual(dup.json()["error"]["code"], "SITE_NAME_EXISTS")

        client.patch(f"/api/v1/pumps/{self.pa1.id}/my-settings", json={"site_id": sid}, headers=self.ha)
        listed = {s["id"]: s for s in client.get("/api/v1/sites", headers=self.ha).json()["sites"]}
        self.assertEqual(listed[sid]["pump_count"], 1)

        # B can neither see, rename nor delete A's site
        self.assertNotIn(sid, [s["id"] for s in client.get("/api/v1/sites", headers=self.hb).json()["sites"]])
        self.assertEqual(client.patch(f"/api/v1/sites/{sid}", json={"name": "x"}, headers=self.hb).status_code, 404)
        self.assertEqual(client.delete(f"/api/v1/sites/{sid}", headers=self.hb).status_code, 404)

        ren = client.patch(f"/api/v1/sites/{sid}", json={"name": f"Renamed {self.sfx}"}, headers=self.ha)
        self.assertEqual(ren.json()["name"], f"Renamed {self.sfx}")

        # deleting the site keeps the pump, ungrouped
        self.assertEqual(client.delete(f"/api/v1/sites/{sid}", headers=self.ha).status_code, 200)
        p = client.get(f"/api/v1/pumps/{self.pa1.id}", headers=self.ha).json()["pump"]
        self.assertIsNone(p["site_id"])

    def test_requires_login(self):
        self.assertEqual(client.get("/api/v1/sites").status_code, 401)


class TestControlGuards(FarmerAppBase):
    def test_suspended_device_refuses_remote_control(self):
        p = self._pump("SUS", self.a)
        p.lifecycle_state = "SUSPENDED"
        self.db.commit()
        cmd = client.post(f"/api/v1/pumps/{p.id}/commands", json={"command": "START"}, headers=self.ha)
        self.assertEqual(cmd.status_code, 403)
        self.assertEqual(cmd.json()["error"]["code"], "DEVICE_SUSPENDED")
        tim = client.put(f"/api/v1/pumps/{p.id}/timer", json={"on_duration_minutes": 10}, headers=self.ha)
        self.assertEqual(tim.status_code, 403)

    def test_timer_limits(self):
        p = self._pump("TIM", self.a)
        url = f"/api/v1/pumps/{p.id}/timer"
        for bad in ({"on_duration_minutes": 0}, {"on_duration_minutes": 251},
                    {"on_duration_minutes": 10, "off_duration_minutes": 251},
                    {"on_duration_minutes": 10, "cycle_count": 1000},
                    {"on_duration_minutes": 10, "cycle_count": -1}):
            self.assertEqual(client.put(url, json=bad, headers=self.ha).status_code, 422, bad)
        ok = client.put(url, json={"on_duration_minutes": 250, "off_duration_minutes": 0, "cycle_count": 0}, headers=self.ha)
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertEqual(ok.json()["timer"]["cycle_count"], 0, "0 cycles must not be coerced to 1")

    def test_write_then_read_keeps_the_actor_context_with_a_busy_pool(self):
        """A request that commits and then reads must stay on the connection that carries its RLS context.

        With several idle connections in the pool, a session that releases its connection on commit()
        picks a different one for the next statement, which has no actor context, so the freshly
        inserted command could not be read back (HTTP 500).
        """
        from app.database import engine
        idle = [engine.connect() for _ in range(6)]
        for c in idle:
            c.close()
        p = self._pump("POOL", self.a)
        for _ in range(3):
            r = client.post(f"/api/v1/pumps/{p.id}/commands", json={"command": "STOP"}, headers=self.ha)
            self.assertIn(r.status_code, (200, 429), r.text)
        r = client.patch(f"/api/v1/pumps/{p.id}/my-settings", json={"nickname": "Pooled"}, headers=self.ha)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["nickname"], "Pooled")

    def test_timer_is_null_until_one_is_sent(self):
        p = self._pump("TN", self.a)
        got = client.get(f"/api/v1/pumps/{p.id}/timer", headers=self.ha)
        self.assertEqual(got.status_code, 200, got.text)
        self.assertIsNone(got.json()["timer"], "no invented default timer")
        client.put(f"/api/v1/pumps/{p.id}/timer", json={"on_duration_minutes": 20, "off_duration_minutes": 5, "cycle_count": 2, "mode": "CYCLIC"}, headers=self.ha)
        again = client.get(f"/api/v1/pumps/{p.id}/timer", headers=self.ha).json()["timer"]
        self.assertEqual((again["on_duration_minutes"], again["off_duration_minutes"], again["cycle_count"]), (20, 5, 2))

    def test_cooldown_carries_retry_after(self):
        p = self._pump("CD", self.a)
        first = client.post(f"/api/v1/pumps/{p.id}/commands", json={"command": "STOP"}, headers=self.ha)
        self.assertEqual(first.status_code, 200, first.text)
        second = client.post(f"/api/v1/pumps/{p.id}/commands", json={"command": "STOP"}, headers=self.ha)
        self.assertEqual(second.status_code, 429)
        self.assertGreater(int(second.headers["Retry-After"]), 0)
        self.assertEqual(second.json()["error"]["code"], "COOLDOWN_ACTIVE")

    def test_command_status_not_readable_by_another_farmer(self):
        p = self._pump("CMD", self.a)
        made = client.post(f"/api/v1/pumps/{p.id}/commands", json={"command": "STOP"}, headers=self.ha).json()
        cid = made["command"]["cid"]
        self.assertEqual(client.get(f"/api/v1/commands/{cid}", headers=self.ha).status_code, 200)
        self.assertEqual(client.get(f"/api/v1/commands/{cid}", headers=self.hb).status_code, 404)


class TestAlerts(FarmerAppBase):
    def _alert(self, pump):
        code = self.db.query(FaultCodeCatalog.code).first()
        a = Alert(pump_id=pump.id, alert_type="FAULT", severity="HIGH", fault_code=code[0] if code else None,
                  dedup_bucket=uuid.uuid4().int % 10**9, occurrence_count=1)
        self.db.add(a)
        self.db.commit()
        return a

    def setUp(self):
        self.al_a, self.al_b = self._alert(self.pa1), self._alert(self.pb)

    def test_list_is_scoped_and_named(self):
        client.patch(f"/api/v1/pumps/{self.pa1.id}/my-settings", json={"nickname": "Field pump"}, headers=self.ha)
        mine = client.get("/api/v1/alerts", headers=self.ha).json()["alerts"]
        ids = {a["id"] for a in mine}
        self.assertIn(str(self.al_a.id), ids)
        self.assertNotIn(str(self.al_b.id), ids)
        row = next(a for a in mine if a["id"] == str(self.al_a.id))
        self.assertEqual(row["pump_name"], "Field pump")

    def test_shared_pump_alerts_are_visible(self):
        self.db.add(DeviceAccess(user_id=self.b.id, device_id=self.pa1.id, role="viewer"))
        self.db.commit()
        try:
            ids = {a["id"] for a in client.get("/api/v1/alerts", headers=self.hb).json()["alerts"]}
            self.assertIn(str(self.al_a.id), ids)
        finally:
            self.db.query(DeviceAccess).filter(DeviceAccess.user_id == self.b.id, DeviceAccess.device_id == self.pa1.id).delete()
            self.db.commit()

    def test_cannot_act_on_another_farmers_alert(self):
        for path in ("ack", "resolve"):
            r = client.post(f"/api/v1/alerts/{self.al_b.id}/{path}", json={"resolution_note": "x"}, headers=self.ha)
            self.assertEqual(r.status_code, 404, path)
        self.assertEqual(client.post("/api/v1/alerts/not-a-uuid/ack", headers=self.ha).status_code, 404)
        self.assertEqual(client.post(f"/api/v1/alerts/{self.al_a.id}/assign", json={"assigned_to": str(self.b.id)}, headers=self.ha).status_code, 403)

    def test_ack_then_resolve(self):
        a = self.al_a
        self.assertEqual(client.post(f"/api/v1/alerts/{a.id}/ack", headers=self.ha).status_code, 200)
        self.assertEqual(client.post(f"/api/v1/alerts/{a.id}/resolve", json={"resolution_note": "checked"}, headers=self.ha).status_code, 200)
        self.db.refresh(a)
        self.assertIsNotNone(a.acknowledged_at)
        self.assertIsNotNone(a.resolved_at)
        self.assertEqual(a.resolution_note, "checked")
        still_open = {x["id"] for x in client.get("/api/v1/alerts", headers=self.ha).json()["alerts"]}
        self.assertNotIn(str(a.id), still_open)


class TestAccount(FarmerAppBase):
    def _login(self, user, install):
        r = client.post("/api/v1/auth/login-password", json={
            "phone_number": user.phone, "password": PASSWORD, "app_install_id": install, "device_info": f"Phone {install}"})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_profile_name_and_language(self):
        r = client.patch("/api/v1/auth/me", json={"full_name": "  Ramesh Patil "}, headers=self.ha)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["full_name"], "Ramesh Patil")
        self.assertEqual(client.patch("/api/v1/auth/me", json={"locale": "mr"}, headers=self.ha).json()["locale"], "mr")
        self.assertEqual(client.patch("/api/v1/auth/me", json={"locale": "xx"}, headers=self.ha).status_code, 422)
        self.assertEqual(client.patch("/api/v1/auth/me", json={}, headers=self.ha).status_code, 422)
        self.assertEqual(client.patch("/api/v1/auth/me", json={"full_name": "   "}, headers=self.ha).status_code, 422)

    def test_logout_ends_only_this_session(self):
        one = self._login(self.b, f"inst-1-{self.sfx}")
        two = self._login(self.b, f"inst-2-{self.sfx}")
        h1 = {"Authorization": f"Bearer {one['access_token']}"}
        out = client.post("/api/v1/auth/logout", json={"refresh_token": one["refresh_token"]}, headers=h1)
        self.assertEqual(out.status_code, 200, out.text)
        dead = client.post("/api/v1/auth/refresh", json={"refresh_token": one["refresh_token"], "app_install_id": f"inst-1-{self.sfx}"})
        self.assertEqual(dead.status_code, 401)
        alive = client.post("/api/v1/auth/refresh", json={"refresh_token": two["refresh_token"], "app_install_id": f"inst-2-{self.sfx}"})
        self.assertEqual(alive.status_code, 200, alive.text)

    def test_sessions_list_and_typed_login(self):
        login = self._login(self.a, f"inst-s-{self.sfx}")
        self.assertEqual(login["user"]["role"], "customer")
        self.assertIs(login["user"]["mfa_enabled"], False)
        sess = client.get("/api/v1/auth/me/sessions", headers={"Authorization": f"Bearer {login['access_token']}"}).json()["sessions"]
        self.assertTrue(any(s["app_install_id"] == f"inst-s-{self.sfx}" for s in sess))

    def test_export_contains_only_own_data(self):
        r = client.get("/api/v1/auth/me/export", headers=self.ha)
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["user"]["id"], str(self.a.id))
        ids = {p["id"] for p in body["pumps"]}
        self.assertIn(self.pa1.id, ids)
        self.assertNotIn(self.pb.id, ids)
        self.assertNotIn("password", json.dumps(body).lower())

    def test_deletion_request_is_idempotent(self):
        self.assertIsNone(client.get("/api/v1/auth/me/deletion-request", headers=self.hb).json()["request"])
        first = client.post("/api/v1/auth/me/deletion-request", json={"reason": "not farming"}, headers=self.hb)
        self.assertEqual(first.status_code, 201, first.text)
        second = client.post("/api/v1/auth/me/deletion-request", json={}, headers=self.hb)
        self.assertEqual(second.json()["id"], first.json()["id"])
        state = client.get("/api/v1/auth/me/deletion-request", headers=self.hb).json()["request"]
        self.assertEqual(state["status"], "PENDING")
        # the account itself is untouched
        self.assertEqual(client.get("/api/v1/auth/me", headers=self.hb).status_code, 200)


class TestWebSocketScope(FarmerAppBase):
    def test_path_boundary(self):
        f = WebSocketHub._path_in_scope
        self.assertTrue(f("/SA/D1", "/SA/D1/F1"))
        self.assertTrue(f("/SA/D1", "/SA/D1"))
        self.assertFalse(f("/SA/D1", "/SA/D10/F1"), "D1 must not cover D10")
        self.assertFalse(f("", "/SA/D1"), "an empty path never matches")
        self.assertFalse(f("/SA/D1", None))

    def test_hub_delivery_rules(self):
        class Sock:
            def __init__(self):
                self.got = []

            async def send_text(self, s):
                self.got.append(json.loads(s))

        async def run():
            hub = WebSocketHub()
            farmer, other, anon, partner = Sock(), Sock(), Sock(), Sock()
            hub.active_connections = {
                farmer: {"role": "customer", "pump_ids": {"P1"}, "hierarchy_path": "/customers/x", "subscriptions": None},
                other: {"role": "customer", "pump_ids": {"P2"}, "hierarchy_path": "", "subscriptions": None},
                anon: None,
                partner: {"role": "dealer", "hierarchy_path": "/SA/D1", "pump_ids": None, "subscriptions": None},
            }
            await hub.broadcast_pump_update("P1", {"x": 1}, "/SA/D1/F1")
            await hub.broadcast_pump_update("P2", {"x": 2}, "/SA/D10/F2")
            return farmer.got, other.got, anon.got, partner.got

        f, o, a, p = asyncio.run(run())
        self.assertEqual([m["pump_id"] for m in f], ["P1"])
        self.assertEqual([m["pump_id"] for m in o], ["P2"])
        self.assertEqual(a, [], "unauthenticated sockets get nothing")
        self.assertEqual([m["pump_id"] for m in p], ["P1"], "dealer sees D1 but not D10")

    def test_subscription_restricts_delivery(self):
        hub = WebSocketHub()
        meta = {"role": "customer", "pump_ids": {"P1", "P2"}, "subscriptions": {"P2"}}
        self.assertFalse(hub._is_in_scope(meta, "P1", None))
        self.assertTrue(hub._is_in_scope(meta, "P2", None))

    def test_socket_auth_first_and_subscribe(self):
        with client.websocket_connect("/ws") as ws:
            token = sign_token({"sub": str(self.a.id), "role": "customer", "hierarchy_path": "", "session_ver": 1})
            ws.send_text(json.dumps({"type": "auth", "token": token}))
            self.assertEqual(ws.receive_json()["type"], "auth_ok")
            ws.send_text(json.dumps({"type": "subscribe", "pump_ids": [self.pa1.id, self.pb.id]}))
            sub = ws.receive_json()
            self.assertEqual(sub["type"], "subscribed")
            self.assertEqual(sub["pump_ids"], [self.pa1.id])
            self.assertEqual(sub["rejected"], [self.pb.id])
            ws.send_text(json.dumps({"type": "ping"}))
            self.assertEqual(ws.receive_json()["type"], "pong")

    def test_socket_rejects_bad_token(self):
        with client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({"type": "auth", "token": "nope"}))
            with self.assertRaises(Exception):
                ws.receive_json()

    def test_socket_rejects_revoked_session(self):
        stale = sign_token({"sub": str(self.a.id), "role": "customer", "hierarchy_path": "", "session_ver": 0})
        with client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({"type": "auth", "token": stale}))
            with self.assertRaises(Exception):
                ws.receive_json()


class TestHttpTelemetry(FarmerAppBase):
    def test_reading_updates_pump_and_reaches_the_farmer(self):
        p = self._pump("HTTP", self.a)
        body = {"vl": [410.0, 412.0, 409.0], "i": [0.0, 0.0, 0.0], "mot": 0, "flt": 0, "rt": 777, "rssi": -70, "seq": 424242}
        r = client.post("/api/v1/telemetry", json=body, headers={"X-Device-Id": p.id})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["status"], "STOPPED", "a stopped pump is STOPPED, never an out-of-range status")
        detail = client.get(f"/api/v1/pumps/{p.id}", headers=self.ha).json()
        self.assertEqual(detail["pump"]["total_runtime_min"], 777)
        self.assertEqual(detail["latest_telemetry"]["signal_dbm"], -70)
        seen = datetime.fromisoformat(detail["pump"]["last_seen_at"])
        self.assertIsNotNone(seen.tzinfo)
        self.assertLess(abs((datetime.now(timezone.utc) - seen).total_seconds()), 30, "last_seen_at must be the real instant, whatever the DB timezone")
        cmd = client.post(f"/api/v1/pumps/{p.id}/commands", json={"command": "START"}, headers=self.ha).json()["command"]
        issued = datetime.fromisoformat(client.get(f"/api/v1/commands/{cmd['cid']}", headers=self.ha).json()["issued_at"])
        self.assertLess(abs((datetime.now(timezone.utc) - issued).total_seconds()), 30)


class TestHttpTelemetryFault(FarmerAppBase):
    def test_fault_reading_is_stored_and_shows_in_the_app(self):
        if not self.db.query(FaultCodeCatalog).filter(FaultCodeCatalog.code == 2).first():
            self.db.add(FaultCodeCatalog(code=2, name="PhaseLoss", severity="CRITICAL", description="PhaseLoss"))
            self.db.commit()
        p = self._pump("FLT", self.a)
        body = {"vl": [0.0, 415.0, 409.0], "i": [0.0, 0.0, 0.0], "mot": 0, "flt": 2, "rt": 10, "rssi": -80, "seq": 515151}
        r = client.post("/api/v1/telemetry", json=body, headers={"X-Device-Id": p.id})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["status"], "FAULT")
        pump = client.get(f"/api/v1/pumps/{p.id}", headers=self.ha).json()["pump"]
        self.assertEqual(pump["fault_code"], 2)
        self.assertTrue(pump["fault_active"])
        faults = client.get(f"/api/v1/pumps/{p.id}/faults?status=all", headers=self.ha).json()
        self.assertEqual([f["fault_code"] for f in faults], [2])
        alerts = client.get("/api/v1/alerts", headers=self.ha).json()["alerts"]
        self.assertTrue(any(a["pump_id"] == p.id and a["fault_code"] == 2 for a in alerts))


class TestIngestRunTime(FarmerAppBase):
    def test_total_runtime_and_fault_fields_reach_the_snapshot(self):
        pid = self._pump("ING", self.a).id  # the device id sent by the bridge is the pump id
        payload = {"dev_id": pid, "vl": [415.0, 412.0, 410.0], "i": [12.0, 12.1, 12.2], "mot": 1, "st": 2,
                   "flt": 0, "rt": 4321, "rssi": -71, "seq": 91000 + int(self.sfx[:3], 16) % 1000}
        body = dict(payload, clientid=pid)
        handled = asyncio.run(process_batch([{"Body": json.dumps(body), "ReceiptHandle": "r-fa"}]))
        self.assertIn("r-fa", handled)
        self.db.expire_all()
        fresh = self.db.query(Pump).filter(Pump.id == pid).first()
        self.assertEqual(fresh.total_runtime_min, 4321)

        detail = client.get(f"/api/v1/pumps/{pid}", headers=self.ha).json()
        self.assertEqual(detail["pump"]["total_runtime_min"], 4321)
        self.assertEqual(detail["latest_telemetry"]["signal_dbm"], -71)
        self.assertIsNone(detail["latest_telemetry"]["fault_code"])
        self.assertIs(detail["latest_telemetry"]["pump_on"], True)


class TestAuditErasure(FarmerAppBase):
    def test_account_can_be_erased_but_audit_rows_stay_unalterable(self):
        from sqlalchemy.exc import DBAPIError
        u = self._user("Z")
        row = AuditLog(actor_id=u.id, actor_role="customer", entity_type="USER", entity_id=str(u.id),
                       action="TEST_ERASURE", before_json=None, after_json={"k": 1})
        self.db.add(row)
        self.db.commit()
        audit_id = row.id

        # erasing the account clears only who acted; the record itself survives
        self.db.query(User).filter(User.id == u.id).delete(synchronize_session=False)
        self.db.commit()
        self.users.remove(u)
        kept = self.db.execute(text("SELECT actor_id, action FROM agripump.audit_log WHERE id = :i"), {"i": audit_id}).one()
        self.assertIsNone(kept[0])
        self.assertEqual(kept[1], "TEST_ERASURE")

        # any other change is refused (by the trigger, or silently ignored by a legacy rule)
        for stmt in ("UPDATE agripump.audit_log SET action = 'EDITED' WHERE id = :i",
                     "DELETE FROM agripump.audit_log WHERE id = :i"):
            try:
                self.db.execute(text(stmt), {"i": audit_id})
                self.db.commit()
            except DBAPIError:
                self.db.rollback()
            self.db.execute(text("SET app.bypass_rls = 'on';"))
            still = self.db.execute(text("SELECT action FROM agripump.audit_log WHERE id = :i"), {"i": audit_id}).all()
            self.assertEqual([r[0] for r in still], ["TEST_ERASURE"], stmt)


if __name__ == "__main__":
    unittest.main()
