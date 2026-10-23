"""Brands: one server, one app per manufacturer (alembic phase5_brands, app/services/brand_service.py).

Covers what a second manufacturer relies on: each app is told only its own settings, a farmer's app lists only that brand's
pumps (and cannot reach another brand's pump by id), a partner cannot sign in to another brand's app, new devices and
accounts get the right brand, a suspended brand stops, and each brand's OTPs leave from its own sender account.

Runs against the local development database; every row created here is removed again.
"""
import os
import sys
import unittest
import uuid
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import settings
from app.main import app
from app.models import AppBrand, AuditLog, DeviceConfig, Pump, User
from app.services import brand_service
from app.services.brand_service import current_brand
from test_web_portal_hardening import PASSWORD, MfaBase  # noqa: E402
from test_web_portal_users import _h, _partner, _verify_phone  # noqa: E402

client = TestClient(app)


def with_brand(user, key):
    return {**_h(user), "X-App-Brand": key}


class BrandBase(MfaBase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.keys = []
        cls.brand_a = cls.add_brand(f"tba-{cls.sfx}", "Test A Controller")
        cls.brand_b = cls.add_brand(f"tbb-{cls.sfx}", "Test B Controller")
        cls.pump_ids = []

    @classmethod
    def add_brand(cls, key, name, **extra):
        b = AppBrand(key=key, name=name, short_name=name.split()[0].upper(), features={}, **extra)
        cls.db.add(b)
        cls.db.commit()
        cls.keys.append(key)
        return b

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            if cls.pump_ids:
                cls.db.query(DeviceConfig).filter(DeviceConfig.pump_id.in_(cls.pump_ids)).delete(synchronize_session=False)
                cls.db.query(Pump).filter(Pump.id.in_(cls.pump_ids)).delete(synchronize_session=False)
            ids = list(cls.user_ids)
            # Accounts first (they point at the brands), then the brands.
            from app.models import RefreshToken
            cls.db.query(RefreshToken).filter(RefreshToken.user_id.in_(ids)).delete(synchronize_session=False)
            created = [r[0] for r in cls.db.execute(
                text("SELECT id FROM agripump.users WHERE brand_id IN (SELECT id FROM agripump.brands WHERE key = ANY(:keys))"),
                {"keys": cls.keys}).fetchall()]
            cls.db.query(RefreshToken).filter(RefreshToken.user_id.in_(created)).delete(synchronize_session=False)
            cls.db.query(User).filter(User.id.in_(ids + created)).delete(synchronize_session=False)
            cls.db.execute(text("DELETE FROM agripump.brands WHERE key = ANY(:keys)"), {"keys": cls.keys})
            cls.db.commit()
        finally:
            brand_service.forget()
            cls.db.close()

    def pump(self, owner, brand):
        pid = f"B{self.sfx}-{uuid.uuid4().hex[:8]}".upper()
        self.db.add(Pump(id=pid, name="Brand test pump", owner_user_id=owner.id, hierarchy_path=owner.hierarchy_path,
                         lifecycle_state="ACTIVE", brand_id=brand.id if brand is not None else None))
        self.db.commit()
        type(self).pump_ids.append(pid)
        return pid

    def partner(self, role, tag, brand, parent=None):
        user = _partner(self, role, tag, parent=parent)
        user = self.db.query(User).filter(User.id == user.id).one()
        user.brand_id = brand.id if brand is not None else None
        self.db.commit()
        return user

    def listed(self, user, key=None):
        headers = with_brand(user, key) if key else _h(user)
        r = client.get("/api/v1/pumps", headers=headers)
        self.assertEqual(r.status_code, 200, r.text)
        return {p["id"] for p in r.json()["pumps"]}


class TestAppConfig(BrandBase):
    def test_each_app_reads_its_own_settings_and_no_secrets(self):
        self.db.query(AppBrand).filter(AppBrand.key == self.brand_a.key).update(
            {"support_name": "Test A Support", "support_phone": "+919000000001", "whatsapp_phone_id": "111222333", "min_app_version": "1.2.0",
             "features": {"timer": True}})
        self.db.commit()
        brand_service.forget()
        r = client.get("/api/v1/app/config", headers={"X-App-Brand": self.brand_a.key})
        self.assertEqual(r.status_code, 200, r.text)
        brand = r.json()["brand"]
        self.assertEqual((brand["key"], brand["name"], brand["min_app_version"]), (self.brand_a.key, "Test A Controller", "1.2.0"))
        self.assertEqual(brand["support"]["phone"], "+919000000001")
        self.assertEqual(brand["features"], {"timer": True})
        self.assertNotIn("whatsapp_phone_id", r.text, "sender settings are not for the app")
        other = client.get("/api/v1/app/config", headers={"X-App-Brand": self.brand_b.key}).json()["brand"]
        self.assertEqual(other["name"], "Test B Controller")

    def test_the_header_is_required_and_must_name_a_brand(self):
        self.assertEqual(client.get("/api/v1/app/config").status_code, 400)
        unknown = client.get("/api/v1/app/config", headers={"X-App-Brand": "no-such-brand"})
        self.assertEqual((unknown.status_code, unknown.json()["error"]["code"]), (404, "BRAND_UNKNOWN"))
        self.assertEqual(client.get("/api/v1/app/config", headers={"X-App-Brand": "../etc"}).status_code, 404)

    def test_a_suspended_brand_stops_its_app_and_only_its_app(self):
        farmer = self.make_user("customer", "susp-farmer")
        try:
            self.db.query(AppBrand).filter(AppBrand.key == self.brand_b.key).update({"status": "SUSPENDED"})
            self.db.commit()
            brand_service.forget()
            stopped = client.get("/api/v1/pumps", headers=with_brand(farmer, self.brand_b.key))
            self.assertEqual((stopped.status_code, stopped.json()["error"]["code"]), (403, "BRAND_DISABLED"))
            self.assertEqual(client.get("/api/v1/pumps", headers=with_brand(farmer, self.brand_a.key)).status_code, 200)
            self.assertEqual(client.get("/api/v1/pumps", headers=_h(farmer)).status_code, 200, "the web portal and older apps are unaffected")
        finally:
            self.db.query(AppBrand).filter(AppBrand.key == self.brand_b.key).update({"status": "ACTIVE"})
            self.db.commit()
            brand_service.forget()


class TestBrandIsolation(BrandBase):
    def setUp(self):
        self.farmer = self.make_user("customer", "farmer")
        self.pump_a = self.pump(self.farmer, self.brand_a)
        self.pump_b = self.pump(self.farmer, self.brand_b)

    def test_a_farmer_with_pumps_of_two_brands_sees_each_brands_pumps_in_its_own_app(self):
        a, b = self.pump_a, self.pump_b
        self.assertEqual(self.listed(self.farmer, self.brand_a.key) & {a, b}, {a})
        self.assertEqual(self.listed(self.farmer, self.brand_b.key) & {a, b}, {b})
        self.assertEqual(self.listed(self.farmer) & {a, b}, {a, b}, "without a brand (web portal, older app) nothing is filtered")

    def test_even_the_super_admin_sees_one_brand_in_a_brands_app(self):
        sa = _partner(self, "superadmin", "sa")
        self.assertIn(self.pump_a, self.listed(sa, self.brand_a.key))
        self.assertNotIn(self.pump_b, self.listed(sa, self.brand_a.key))
        self.assertTrue({self.pump_a, self.pump_b} <= self.listed(sa))

    def test_another_brands_pump_cannot_be_reached_by_id_from_this_app(self):
        h = with_brand(self.farmer, self.brand_a.key)
        self.assertEqual(client.get(f"/api/v1/pumps/{self.pump_a}", headers=h).status_code, 200)
        self.assertEqual(client.get(f"/api/v1/pumps/{self.pump_b}", headers=h).status_code, 404)
        self.assertEqual(client.post(f"/api/v1/pumps/{self.pump_b}/commands", json={"action": "START"}, headers=h).status_code, 404)
        self.assertEqual(client.get(f"/api/v1/pumps/{self.pump_b}", headers=_h(self.farmer)).status_code, 200)


class TestBrandSignIn(BrandBase):
    def login(self, user, key=None):
        headers = {"X-App-Brand": key} if key else {}
        return client.post("/api/v1/auth/login-password", json={"phone_number": user.phone, "password": PASSWORD}, headers=headers)

    def test_a_partner_signs_in_to_its_own_brands_app_only(self):
        dealer = self.partner("dealer", "dealer-b", self.brand_b)
        wrong = self.login(dealer, self.brand_a.key)
        self.assertEqual((wrong.status_code, wrong.json()["error"]["code"]), (403, "WRONG_BRAND_APP"))
        self.assertEqual(self.login(dealer, self.brand_b.key).status_code, 200)
        self.assertEqual(self.login(dealer).status_code, 200, "the web portal has no brand")

    def test_a_farmer_and_the_platform_admin_sign_in_to_any_brands_app(self):
        farmer = self.make_user("customer", "farmer-any")
        sa = _partner(self, "superadmin", "sa-any")
        for key in (self.brand_a.key, self.brand_b.key):
            self.assertEqual(self.login(farmer, key).status_code, 200)
            self.assertEqual(self.login(sa, key).status_code, 200)

    def test_a_partner_with_no_brand_is_not_blocked(self):
        legacy = self.partner("dealer", "dealer-none", None)
        self.assertEqual(self.login(legacy, self.brand_a.key).status_code, 200)


class TestNewThingsGetABrand(BrandBase):
    def create_pump(self, user, **body):
        pid = f"B{self.sfx}-{uuid.uuid4().hex[:8]}".upper()
        type(self).pump_ids.append(pid)
        return pid, client.post("/api/v1/pumps", json={"id": pid, "name": "New", **body}, headers=user[0])

    def brand_of(self, pump_id):
        self.db.expire_all()
        return self.db.query(Pump).filter(Pump.id == pump_id).one().brand_id

    def test_a_partners_devices_are_its_brands(self):
        dealer = self.partner("dealer", "creator-a", self.brand_a)
        pid, r = self.create_pump((_h(dealer),))
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(self.brand_of(pid), self.brand_a.id)
        _, refused = self.create_pump((_h(dealer),), brand=self.brand_b.key)
        self.assertEqual(refused.status_code, 403, "a partner cannot create devices for another brand")

    def test_the_super_admin_names_the_brand_or_it_comes_from_the_app_or_the_default(self):
        sa = _partner(self, "superadmin", "sa-create")
        pid, r = self.create_pump((_h(sa),), brand=self.brand_b.key)
        self.assertEqual((r.status_code, self.brand_of(pid)), (201, self.brand_b.id), r.text)
        pid, r = self.create_pump((with_brand(sa, self.brand_a.key),))
        self.assertEqual((r.status_code, self.brand_of(pid)), (201, self.brand_a.id), r.text)
        pid, r = self.create_pump((_h(sa),))
        default = self.db.query(AppBrand.id).filter(AppBrand.key == brand_service.default_key()).scalar()
        self.assertEqual((r.status_code, self.brand_of(pid)), (201, default), r.text)
        self.assertEqual(self.create_pump((_h(sa),), brand="nope")[1].status_code, 422)

    def test_a_partner_account_made_by_a_partner_inherits_its_brand_a_farmer_has_none(self):
        dealer = self.partner("dealer", "parent-a", self.brand_a)
        made = {}
        for role in ("dealer", "customer"):
            phone = f"90{uuid.uuid4().int % 10**8:08d}"
            ticket = _verify_phone(phone)
            body = {"full_name": f"Child {role}", "phone_number": phone, "role": role, "phone_verification_token": ticket}
            if role != "customer":
                body["password"] = "Strong-Pass-1"
            r = client.post("/api/v1/users", json=body, headers=_h(dealer))
            self.assertEqual(r.status_code, 201, r.text)
            made[role] = r.json()["user"]["id"]
            type(self).user_ids.append(uuid.UUID(made[role]))
        self.db.expire_all()
        self.assertEqual(self.db.query(User).filter(User.id == made["dealer"]).one().brand_id, self.brand_a.id)
        self.assertIsNone(self.db.query(User).filter(User.id == made["customer"]).one().brand_id)


class TestBrandAdminApi(BrandBase):
    def test_only_the_super_admin_manages_brands(self):
        dealer = self.partner("dealer", "no-admin", self.brand_a)
        self.assertEqual(client.get("/api/v1/brands", headers=_h(dealer)).status_code, 403)
        self.assertEqual(client.post("/api/v1/brands", json={"key": "x-nope", "name": "X"}, headers=_h(dealer)).status_code, 403)
        self.assertEqual(client.get("/api/v1/brands").status_code, 401)

    def test_create_validate_update_and_suspend(self):
        sa = _partner(self, "superadmin", "sa-brands")
        key = f"tc-{self.sfx}"
        type(self).keys.append(key)
        created = client.post("/api/v1/brands", headers=_h(sa), json={
            "key": key, "name": "Created Controller", "primary_color": "#1B4FB8", "support_phone": "+919000000002",
            "android_package": "com.created.pump", "min_app_version": "1.0", "sms_sender_id": "CRTD01", "features": {"timer": True}})
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()["brand"]["status"], "ACTIVE")
        self.assertEqual(client.post("/api/v1/brands", json={"key": key, "name": "Again"}, headers=_h(sa)).status_code, 409)

        for bad in ({"key": "platform", "name": "Reserved"}, {"key": "Bad Key", "name": "Bad"}, {"key": "tc2-x", "name": "X", "primary_color": "green"},
                    {"key": "tc3-x", "name": "X", "android_package": "nodots"}, {"key": "tc4-x", "name": "X", "support_phone": "call me"},
                    {"key": "tc5-x", "name": "X", "features": {"a": {"nested": 1}}}, {"key": "tc6-x", "name": "X", "org_id": str(uuid.uuid4())}):
            self.assertEqual(client.post("/api/v1/brands", json=bad, headers=_h(sa)).status_code, 422, bad)

        # It is live at once, and suspending it stops the app.
        self.assertEqual(client.get("/api/v1/app/config", headers={"X-App-Brand": key}).json()["brand"]["primary_color"], "#1B4FB8")
        changed = client.put(f"/api/v1/brands/{key}", json={"support_name": "Helpdesk", "status": "SUSPENDED"}, headers=_h(sa))
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(client.get("/api/v1/app/config", headers={"X-App-Brand": key}).status_code, 403)
        self.assertEqual(client.put(f"/api/v1/brands/{key}", json={"status": "ACTIVE"}, headers=_h(sa)).status_code, 200)
        self.assertEqual(client.get("/api/v1/app/config", headers={"X-App-Brand": key}).json()["brand"]["support"]["name"], "Helpdesk")
        self.assertEqual(client.put("/api/v1/brands/nope", json={"name": "Nope"}, headers=_h(sa)).status_code, 404)
        self.assertEqual(client.put(f"/api/v1/brands/{key}", json={"status": "GONE"}, headers=_h(sa)).status_code, 422)

        listed = {b["key"] for b in client.get("/api/v1/brands", headers=_h(sa)).json()["brands"]}
        self.assertTrue({"ajanta", key} <= listed)
        actions = {a for (a,) in self.db.query(AuditLog.action).filter(AuditLog.entity_type == "brand", AuditLog.entity_id == key).all()}
        self.assertTrue({"BRAND_CREATED", "BRAND_SUSPENDED", "BRAND_ACTIVATED"} <= actions)


class TestPerBrandSenders(BrandBase):
    def test_a_setting_comes_from_the_brands_env_then_its_row_then_the_platform(self):
        b = self.db.query(AppBrand).filter(AppBrand.key == self.brand_a.key).one()
        b.whatsapp_phone_id, b.whatsapp_template = "BRAND-PHONE-ID", "brand_otp"
        self.db.commit()
        brand_service.forget()
        info = brand_service.resolve(self.brand_a.key)
        env_name = f"BRAND_{self.brand_a.key.upper().replace('-', '_')}_WHATSAPP_API_TOKEN"
        with patch.dict(os.environ, {env_name: "brand-token"}), patch.object(settings, "WHATSAPP_API_TOKEN", "platform-token"):
            self.assertEqual(brand_service.channel_setting("WHATSAPP_API_TOKEN", info), "brand-token")
            self.assertEqual(brand_service.channel_setting("WHATSAPP_PHONE_ID", info), "BRAND-PHONE-ID")
            self.assertEqual(brand_service.channel_setting("WHATSAPP_OTP_TEMPLATE", info), "brand_otp")
        with patch.object(settings, "WHATSAPP_API_TOKEN", "platform-token"), patch.object(settings, "WHATSAPP_OTP_LANGUAGE", "en_IN"):
            self.assertEqual(brand_service.channel_setting("WHATSAPP_API_TOKEN", info), "platform-token", "no env of its own: the platform's")
            self.assertEqual(brand_service.channel_setting("WHATSAPP_OTP_LANGUAGE", info), "en_IN")
            self.assertEqual(brand_service.channel_setting("WHATSAPP_API_TOKEN", None), "platform-token", "no brand at all")

    def test_the_support_contact_is_the_brands_else_the_platforms(self):
        b = self.db.query(AppBrand).filter(AppBrand.key == self.brand_a.key).one()
        b.support_name, b.support_phone = "Brand Support", "+919000000003"
        self.db.commit()
        brand_service.forget()
        with patch.object(settings, "SUPPORT_ESCALATION_NAME", "Platform Support"), patch.object(settings, "SUPPORT_ESCALATION_EMAIL", "help@platform.test"):
            mine = brand_service.support_contact(brand_service.resolve(self.brand_a.key))
            self.assertEqual((mine["name"], mine["phone"], mine["email"]), ("Brand Support", "+919000000003", "help@platform.test"))
            theirs = brand_service.support_contact(brand_service.resolve(self.brand_b.key))
            self.assertEqual(theirs["name"], "Platform Support")

    def test_the_whatsapp_code_leaves_from_the_calling_apps_account(self):
        from app.services.notification_service import send_whatsapp_otp
        b = self.db.query(AppBrand).filter(AppBrand.key == self.brand_a.key).one()
        b.whatsapp_phone_id, b.whatsapp_template, b.whatsapp_language = "BRAND-PHONE-ID", "brand_otp", "hi"
        self.db.commit()
        brand_service.forget()
        env_name = f"BRAND_{self.brand_a.key.upper().replace('-', '_')}_WHATSAPP_API_TOKEN"
        sent = {}

        class FakeClient:
            def __init__(self, *a, **k): pass
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def post(self, url, headers=None, json=None):
                sent.update(url=url, headers=headers, payload=json)
                return MagicMock(status_code=200, json=lambda: {"ok": True})

        token = current_brand.set(brand_service.resolve(self.brand_a.key))
        try:
            with patch.dict(os.environ, {env_name: "brand-token"}), patch("app.services.notification_service.httpx.Client", FakeClient):
                self.assertEqual(send_whatsapp_otp("+919000000009", "654321")["status"], "dispatched")
        finally:
            current_brand.reset(token)
        self.assertIn("/BRAND-PHONE-ID/messages", sent["url"])
        self.assertEqual(sent["headers"]["Authorization"], "Bearer brand-token")
        self.assertEqual(sent["payload"]["template"]["name"], "brand_otp")
        self.assertEqual(sent["payload"]["template"]["language"]["code"], "hi")


class TestManufacturerPortals(BrandBase):
    """The platform owner above the manufacturers, each manufacturer with its own tree, and a wall between them.

    super admin -> manufacturer (the brand's owner account) -> dealer -> farmer -> pump, once per brand."""

    def tree(self, brand, tag):
        from types import SimpleNamespace
        mfr = self.partner("manufacturer", f"mfr-{tag}", brand)
        dealer = self.partner("dealer", f"dlr-{tag}", brand, parent=mfr)
        farmer = self.db.query(User).filter(User.id == self.make_user("customer", f"frm-{tag}").id).one()
        farmer.hierarchy_path, farmer.parent_user_id = f"{dealer.hierarchy_path}/{farmer.id}", dealer.id
        self.db.commit()
        pump = self.pump(farmer, brand)
        self.db.query(AppBrand).filter(AppBrand.id == brand.id).update({"owner_user_id": mfr.id})
        self.db.commit()
        return SimpleNamespace(mfr=mfr, dealer=dealer, farmer=farmer, pump=pump)

    def setUp(self):
        self.a = self.tree(self.brand_a, "a")
        self.b = self.tree(self.brand_b, "b")
        self.sa = _partner(self, "superadmin", "sa-portal")

    @staticmethod
    def viewing(user, key):
        return {**_h(user), "X-View-Manufacturer": key}

    def view_pumps(self, user, key):
        r = client.get("/api/v1/pumps", headers=self.viewing(user, key))
        self.assertEqual(r.status_code, 200, r.text)
        return {p["id"] for p in r.json()["pumps"]}

    def test_the_super_admin_opening_a_manufacturer_sees_exactly_that_manufacturers_tree(self):
        mine = {self.a.pump, self.b.pump}
        self.assertEqual(self.view_pumps(self.sa, self.brand_a.key) & mine, {self.a.pump})
        self.assertEqual(self.view_pumps(self.sa, self.brand_b.key) & mine, {self.b.pump})
        self.assertTrue(mine <= self.listed(self.sa), "without the header the platform owner still sees everything")
        users = client.get("/api/v1/users", headers=self.viewing(self.sa, self.brand_a.key)).json()
        phones = {u["phone"] for u in users}
        self.assertIn(self.a.dealer.phone, phones)
        self.assertNotIn(self.b.dealer.phone, phones)
        self.assertNotIn(self.b.farmer.phone, phones)
        fleet = client.get("/api/v1/fleet/dashboard", headers=self.viewing(self.sa, self.brand_b.key)).json()
        self.assertEqual(fleet["summary"]["total"], 1)

    def test_viewing_is_read_only(self):
        h = self.viewing(self.sa, self.brand_a.key)
        refused = client.post("/api/v1/pumps", json={"id": f"X{self.sfx}", "name": "No"}, headers=h)
        self.assertEqual((refused.status_code, refused.json()["error"]["code"]), (403, "VIEW_ONLY"))
        self.assertEqual(client.post(f"/api/v1/pumps/{self.a.pump}/commands", json={"action": "START"}, headers=h).status_code, 403)
        self.assertEqual(client.get(f"/api/v1/pumps/{self.a.pump}", headers=h).status_code, 200)

    def test_only_the_super_admin_can_use_the_header(self):
        # A manufacturer or dealer sending another manufacturer's key still only gets its own tree.
        for who in (self.a.mfr, self.a.dealer):
            ids = self.view_pumps(who, self.brand_b.key)
            self.assertIn(self.a.pump, ids)
            self.assertNotIn(self.b.pump, ids)
        self.assertEqual(client.get(f"/api/v1/pumps/{self.b.pump}", headers=self.viewing(self.a.mfr, self.brand_b.key)).status_code, 404)

    def test_an_unknown_manufacturer_or_one_without_an_account_is_refused_not_guessed(self):
        unknown = client.get("/api/v1/pumps", headers=self.viewing(self.sa, "no-such-one"))
        self.assertEqual((unknown.status_code, unknown.json()["error"]["code"]), (404, "MANUFACTURER_UNKNOWN"))
        self.db.query(AppBrand).filter(AppBrand.id == self.brand_b.id).update({"owner_user_id": None})
        self.db.commit()
        empty = client.get("/api/v1/pumps", headers=self.viewing(self.sa, self.brand_b.key))
        self.assertEqual((empty.status_code, empty.json()["error"]["code"]), (404, "MANUFACTURER_HAS_NO_ACCOUNT"))

    def test_the_platforms_own_endpoints_ignore_the_view(self):
        h = self.viewing(self.sa, self.brand_a.key)
        self.assertEqual(client.get("/api/v1/auth/me", headers=h).json()["role"], "superadmin")
        self.assertEqual(client.get("/api/v1/brands", headers=h).status_code, 200)
        self.assertEqual(client.get("/api/v1/brands/overview", headers=h).status_code, 200)

    def test_the_overview_measures_each_manufacturer_by_its_own_tree(self):
        r = client.get("/api/v1/brands/overview", headers=_h(self.sa))
        self.assertEqual(r.status_code, 200, r.text)
        rows = {m["key"]: m for m in r.json()["manufacturers"]}
        for brand, tree in ((self.brand_a, self.a), (self.brand_b, self.b)):
            row = rows[brand.key]
            self.assertEqual((row["farmers"], row["pumps"]["total"], row["team"]), (1, 1, 1), row)
            self.assertEqual(row["owner"]["phone"], tree.mfr.phone)
        self.assertEqual(client.get("/api/v1/brands/overview", headers=_h(self.a.mfr)).status_code, 403)
        self.assertEqual(client.get("/api/v1/brands/overview").status_code, 401)
        self.db.query(AppBrand).filter(AppBrand.id == self.brand_b.id).update({"owner_user_id": None})
        self.db.commit()
        rows = {m["key"]: m for m in client.get("/api/v1/brands/overview", headers=_h(self.sa)).json()["manufacturers"]}
        self.assertEqual((rows[self.brand_b.key]["owner"], rows[self.brand_b.key]["pumps"]["total"]), (None, 0))

    def test_a_new_manufacturer_must_name_its_brand_and_its_first_account_becomes_the_owner(self):
        self.db.query(AppBrand).filter(AppBrand.id == self.brand_b.id).update({"owner_user_id": None})
        self.db.commit()

        def create(**extra):
            phone = f"90{uuid.uuid4().int % 10**8:08d}"
            body = {"full_name": "New Maker", "phone_number": phone, "role": "manufacturer", "password": "Strong-Pass-1",
                    "phone_verification_token": _verify_phone(phone), **extra}
            return client.post("/api/v1/users", json=body, headers=_h(self.sa))

        without = create()
        self.assertEqual(without.status_code, 422, "no silent filing under the default brand")
        first = create(brand=self.brand_b.key)
        self.assertEqual(first.status_code, 201, first.text)
        type(self).user_ids.append(uuid.UUID(first.json()["user"]["id"]))
        self.db.expire_all()
        self.assertEqual(str(self.db.query(AppBrand).filter(AppBrand.id == self.brand_b.id).one().owner_user_id), first.json()["user"]["id"])
        second = create(brand=self.brand_b.key)
        self.assertEqual(second.status_code, 201, second.text)
        type(self).user_ids.append(uuid.UUID(second.json()["user"]["id"]))
        self.db.expire_all()
        self.assertEqual(str(self.db.query(AppBrand).filter(AppBrand.id == self.brand_b.id).one().owner_user_id), first.json()["user"]["id"],
                         "a later manufacturer account does not take over")

    def test_the_owner_of_a_brand_must_be_a_manufacturer_account(self):
        bad = client.put(f"/api/v1/brands/{self.brand_a.key}", json={"owner_user_id": str(self.a.farmer.id)}, headers=_h(self.sa))
        self.assertEqual(bad.status_code, 422)
        ok = client.put(f"/api/v1/brands/{self.brand_a.key}", json={"owner_user_id": str(self.a.mfr.id)}, headers=_h(self.sa))
        self.assertEqual(ok.status_code, 200, ok.text)

    def test_two_manufacturers_never_see_each_others_people_pumps_or_numbers(self):
        endpoints = [
            "/api/v1/pumps", "/api/v1/devices", "/api/v1/fleet/dashboard", "/api/v1/alerts", "/api/v1/sites", "/api/v1/organisations",
            "/api/v1/users", "/api/v1/users/tree", "/api/v1/batches", "/api/v1/audit-log", "/api/v1/service-reports", "/api/v1/panels",
            "/api/v1/config-templates", "/api/v1/dashboard/subtree", "/api/v1/dashboard/connectivity", "/api/v1/dashboard/faults",
            "/api/v1/dashboard/top-faulting-devices", "/api/v1/dashboard/offline-devices", "/api/v1/dashboard/firmware-distribution",
        ]
        for own, other in ((self.a, self.b), (self.b, self.a)):
            foreign = [other.pump, other.mfr.phone, other.dealer.phone, other.farmer.phone, str(other.mfr.id), str(other.dealer.id), str(other.farmer.id)]
            seen_own = False
            for path in endpoints:
                r = client.get(path, headers=_h(own.mfr))
                self.assertLess(r.status_code, 500, f"{path}: {r.text[:200]}")
                for marker in foreign:
                    self.assertNotIn(marker, r.text, f"{path} showed another manufacturer's {marker}")
                seen_own = seen_own or own.pump in r.text or own.farmer.phone in r.text
            self.assertTrue(seen_own, "the check is only meaningful if the manufacturer does see its own data")
            self.assertEqual(client.get(f"/api/v1/pumps/{other.pump}", headers=_h(own.mfr)).status_code, 404)
            self.assertEqual(client.get(f"/api/v1/pumps/{other.pump}", headers=_h(own.dealer)).status_code, 404)

    def test_the_live_socket_follows_the_viewed_manufacturer(self):
        from app.websockets.router import _load_identity
        payload = {"sub": str(self.sa.id), "session_ver": 1}
        plain = _load_identity(payload)
        self.assertEqual(plain["role"], "superadmin")
        viewed = _load_identity(payload, self.brand_a.key)
        self.assertEqual((viewed["role"], viewed["hierarchy_path"]), ("manufacturer", self.a.mfr.hierarchy_path))
        self.assertIsNone(_load_identity(payload, "no-such-one"))
        # A manufacturer asking to view another brand is not given it.
        own = _load_identity({"sub": str(self.a.mfr.id), "session_ver": 1}, self.brand_b.key)
        self.assertEqual(own["hierarchy_path"], self.a.mfr.hierarchy_path)


if __name__ == "__main__":
    unittest.main()
