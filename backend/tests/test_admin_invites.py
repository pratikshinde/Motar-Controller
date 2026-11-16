"""Adding an admin (name, company, address, phone, email): a code emailed to them, the platform owner types it in (that creates the manufacturer and the account), the admin then chooses their own password with the same
code, once, and signs in with email and password from then on. Runs against the local development database; no email is really sent."""
import os
import re
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient

from app.main import app
from app.models import AppBrand, User
from app.models.admin_invite import AdminInvite
from app.services import admin_invites, email_service
from test_web_portal_users import _h, _partner  # noqa: E402
from test_web_portal_hardening import MfaBase  # noqa: E402  (the base class only)

client = TestClient(app)
API = "/api/v1"
PASSWORD = "my-own-long-pass-1"


class Inbox:
    def __init__(self):
        self.sent = []

    def __call__(self, to, subject, body):
        self.sent.append((to, subject, body))

    def code(self):
        return re.search(r"Your code is (\d{6})", self.sent[-1][2]).group(1)


class InviteBase(MfaBase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.emails = []
        cls.brands = []

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(__import__("sqlalchemy").text("SET app.bypass_rls = 'on';"))
            cls.db.query(AdminInvite).filter(AdminInvite.email.in_(cls.emails)).delete(synchronize_session=False)
            ids = [u.id for u in cls.db.query(User).filter(User.email.in_(cls.emails)).all()]
            cls.user_ids.extend(ids)
            cls.db.query(AppBrand).filter(AppBrand.key.in_(cls.brands)).update({"owner_user_id": None}, synchronize_session=False)
            cls.db.commit()
        finally:
            super().tearDownClass()
            # the manufacturers made by these tests go once their admins are gone
            from app.database import SessionLocal

            db = SessionLocal()
            try:
                db.execute(__import__("sqlalchemy").text("SET app.bypass_rls = 'on';"))
                db.query(AppBrand).filter(AppBrand.key.in_(cls.brands)).delete(synchronize_session=False)
                db.commit()
            finally:
                db.close()

    def setUp(self):
        self.inbox = Inbox()
        patcher = patch("app.services.email_service.send_email", self.inbox)
        patcher.start()
        self.addCleanup(patcher.stop)
        cls = type(self)
        if getattr(cls, "owner", None) is None:
            cls.owner = _partner(self, "superadmin", "inv-owner")

    # ---- the platform owner's side
    def email(self):
        address = f"admin-{uuid.uuid4().hex[:8]}@example.com"
        type(self).emails.append(address)
        return address

    def start(self, email=None, actor=None, **over):
        email = email or self.email()
        body = {"full_name": "Meera Joshi", "company_name": f"Testco {uuid.uuid4().hex[:6]} Pumps Pvt Ltd", "address": "Hadapsar, Pune",
                "phone": f"90{uuid.uuid4().int % 10**8:08d}", "email": email, **over}
        r = client.post(f"{API}/users/admin-invites", json=body, headers=_h(actor or self.owner))
        return r, email

    def started(self, **over):
        r, email = self.start(**over)
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()["invite"]["id"], email, self.inbox.code()

    def verify(self, rid, code, actor=None):
        r = client.post(f"{API}/users/admin-invites/{rid}/verify", json={"code": code}, headers=_h(actor or self.owner))
        if r.status_code == 200 and r.json()["invite"].get("brand"):
            type(self).brands.append(r.json()["invite"]["brand"])
        return r

    def added(self):
        rid, email, code = self.started()
        r = self.verify(rid, code)
        self.assertEqual(r.status_code, 200, r.text)
        return rid, email, code

    # ---- the admin's side
    def choose(self, email, password=PASSWORD, code=None):
        body = {"email": email, "password": password}
        if code is not None:
            body["code"] = code
        return client.post(f"{API}/auth/admin-password/set", json=body)

    def ask_reset(self, email):
        return client.post(f"{API}/auth/admin-password/request", json={"email": email})

    def first_time(self, email):
        r = client.post(f"{API}/auth/admin-password/state", json={"email": email})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["first_time"]

    def sign_in(self, email, password=PASSWORD):
        return client.post(f"{API}/auth/login-email", json={"email": email, "password": password})

    def user_of(self, email):
        self.db.expire_all()
        return self.db.query(User).filter(User.email == email).first()


class TestAddingAnAdmin(InviteBase):
    def test_the_code_is_emailed_to_the_admin_and_no_account_exists_yet(self):
        r, email = self.start()
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["invite"]["status"], "WAITING_FOR_CODE")
        self.assertEqual(len(self.inbox.sent), 1)
        self.assertEqual(self.inbox.sent[0][0], email)
        self.assertRegex(self.inbox.sent[0][2], r"\b\d{6}\b")
        self.assertIsNone(self.user_of(email), "nothing but a pending invite")

    def test_only_the_platform_owner_can_add_an_admin(self):
        admin = _partner(self, "manufacturer", "inv-admin", parent=self.owner)
        dealer = _partner(self, "dealer", "inv-dealer", parent=admin)
        for actor in (admin, dealer):
            self.assertEqual(self.start(actor=actor)[0].status_code, 403)
        self.assertEqual(client.post(f"{API}/users/admin-invites", json={}).status_code, 401)
        self.assertEqual(self.inbox.sent, [])

    def test_only_the_five_details_are_asked_and_all_are_needed(self):
        for field, bad in (("full_name", ""), ("company_name", ""), ("address", ""), ("phone", "12345"), ("email", "not-an-email")):
            self.assertEqual(self.start(**{field: bad})[0].status_code, 422, field)
        self.assertEqual(self.inbox.sent, [])

    def test_the_phone_is_ten_digits_and_the_plus_91_is_added(self):
        rid, email, code = self.started(phone="98765 43210")
        row = self.db.query(AdminInvite).filter(AdminInvite.email == email).one()
        self.assertEqual(row.phone, "+919876543210")

    def test_a_phone_number_that_already_has_an_account_is_refused(self):
        rid, email, code = self.added()
        user = self.user_of(email)
        self.assertEqual(self.start(phone=user.phone[-10:])[0].status_code, 409)

    def test_an_email_that_already_has_an_account_is_refused(self):
        rid, email, code = self.added()
        self.assertEqual(self.start(email=email)[0].status_code, 409)

    def test_if_the_email_cannot_be_sent_the_owner_is_told_and_nothing_is_kept(self):
        email = self.email()
        with patch("app.services.email_service.send_email", side_effect=email_service.EmailNotSent("down")):
            r, _ = self.start(email=email)
        self.assertEqual(r.status_code, 502)
        self.db.expire_all()
        self.assertEqual(self.db.query(AdminInvite).filter(AdminInvite.email == email).count(), 0)

    def test_only_a_keyed_hash_of_the_code_is_stored(self):
        rid, email, code = self.started()
        row = self.db.query(AdminInvite).filter(AdminInvite.email == email).one()
        self.assertNotIn(code, row.code_hash)
        self.assertEqual(len(row.code_hash), 64)

    def test_the_list_shows_what_is_not_finished(self):
        rid, email, code = self.started()
        listed = {i["id"]: i for i in client.get(f"{API}/users/admin-invites", headers=_h(self.owner)).json()["invites"]}
        self.assertEqual(listed[rid]["status"], "WAITING_FOR_CODE")
        self.assertEqual(listed[rid]["email"], email)


class TestTheOwnerTypesTheCode(InviteBase):
    def test_a_right_code_creates_the_admin_account_with_no_password_under_the_owner(self):
        rid, email, code = self.started()
        company = self.db.query(AdminInvite).filter(AdminInvite.email == email).one().company_name
        self.assertEqual(self.db.query(AppBrand).filter(AppBrand.name == company).count(), 0, "no manufacturer before the code is confirmed")
        r = self.verify(rid, code)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["invite"]["status"], "WAITING_FOR_PASSWORD")
        user = self.user_of(email)
        self.assertIsNotNone(user)
        self.assertEqual((user.role, user.full_name, user.parent_user_id), ("manufacturer", "Meera Joshi", self.owner.id))
        self.assertTrue(user.is_verified)
        self.assertFalse(user.password_hash)
        brand = self.db.query(AppBrand).filter(AppBrand.id == user.brand_id).one()
        self.assertEqual(brand.owner_user_id, user.id, "the first admin of a brand is that manufacturer")
        self.assertEqual(r.json()["invite"]["brand"], brand.key)
        self.assertTrue(brand.name.startswith("Testco"), "the manufacturer is made from the company name")
        self.assertEqual((brand.support_email, brand.status), (email, "ACTIVE"))
        self.assertEqual((user.phone, user.address), (brand.support_phone, "Hadapsar, Pune"))
        self.assertTrue(user.phone.startswith("+91"))
        self.assertTrue(user.hierarchy_path.startswith(self.owner.hierarchy_path))

    def test_a_company_that_already_has_a_brand_row_gets_that_row_not_a_duplicate(self):
        """The built-in 'ajanta' / 'swati' rows belong to the farmer apps: the admin is attached to them, and no 'name-2' is made."""
        key = f"keep{uuid.uuid4().hex[:6]}"
        self.db.add(AppBrand(key=key, name=f"{key.title()} Pump Controller", short_name=key.upper(), status="ACTIVE", features={}, android_package=f"com.example.{key}"))
        self.db.commit()
        type(self).brands.append(key)
        before = self.db.query(AppBrand).count()
        rid, email, code = self.started(company_name=f"{key.title()} Pumps Pvt Ltd")
        r = self.verify(rid, code)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["invite"]["brand"], key)
        self.db.expire_all()
        self.assertEqual(self.db.query(AppBrand).count(), before, "no second brand beside the existing one")
        brand = self.db.query(AppBrand).filter(AppBrand.key == key).one()
        self.assertEqual(brand.owner_user_id, self.user_of(email).id)
        self.assertEqual(brand.android_package, f"com.example.{key}", "what the farmer app relies on is untouched")

    def test_a_brand_row_with_no_admin_shows_no_card_until_its_admin_is_registered(self):
        key = f"hide{uuid.uuid4().hex[:6]}"
        self.db.add(AppBrand(key=key, name=f"{key.title()} Pump Controller", short_name=key.upper(), status="ACTIVE", features={}))
        self.db.commit()
        type(self).brands.append(key)
        keys = lambda: {m["key"] for m in client.get(f"{API}/brands/overview", headers=_h(self.owner)).json()["manufacturers"]}
        self.assertNotIn(key, keys(), "nothing is shown for a company nobody has registered")
        rid, email, code = self.started(company_name=f"{key.title()} Pumps")
        self.assertEqual(self.verify(rid, code).status_code, 200)
        self.assertIn(key, keys())

    def test_a_wrong_code_is_refused_and_five_burn_the_invite(self):
        rid, email, code = self.started()
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(5):
            self.assertEqual(self.verify(rid, wrong).status_code, 400)
        self.assertEqual(self.verify(rid, code).status_code, 400, "burned: even the right code is refused")
        self.assertIsNone(self.user_of(email))
        status = client.get(f"{API}/users/admin-invites", headers=_h(self.owner)).json()["invites"]
        self.assertEqual({i["id"]: i["status"] for i in status}[rid], "BLOCKED")

    def test_an_expired_code_is_refused(self):
        rid, email, code = self.started()
        self.db.query(AdminInvite).filter(AdminInvite.email == email).update({"expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)})
        self.db.commit()
        self.assertEqual(self.verify(rid, code).status_code, 400)
        self.assertIsNone(self.user_of(email))

    def test_typing_it_twice_does_not_make_a_second_account(self):
        rid, email, code = self.started()
        self.verify(rid, code)
        self.assertEqual(self.verify(rid, code).status_code, 200)
        self.db.expire_all()
        self.assertEqual(self.db.query(User).filter(User.email == email).count(), 1)

    def test_only_the_platform_owner_can_type_it(self):
        rid, email, code = self.started()
        admin = _partner(self, "manufacturer", "inv-other", parent=self.owner)
        self.assertEqual(self.verify(rid, code, actor=admin).status_code, 403)
        self.assertEqual(client.post(f"{API}/users/admin-invites/{rid}/verify", json={"code": code}).status_code, 401)

    def test_the_fixed_development_code_is_refused_when_real_email_is_set_up(self):
        from app.config import settings

        rid, email, code = self.started()
        with patch.object(settings, "EMAIL_BACKEND", "smtp"):
            self.assertEqual(self.verify(rid, "123456").status_code, 400)
        self.assertEqual(self.verify(rid, code).status_code, 200)


class TestTheFirstPassword(InviteBase):
    def test_the_page_is_told_who_still_has_to_choose_a_password(self):
        rid, email, code = self.started()
        self.assertFalse(self.first_time(email), "not confirmed by the owner yet")
        self.verify(rid, code)
        self.assertTrue(self.first_time(email))
        self.assertFalse(self.first_time("nobody@example.com"))
        self.assertFalse(self.first_time("not-an-email"))

    def test_nothing_works_before_the_owner_has_confirmed_the_code(self):
        rid, email, code = self.started()
        self.assertEqual(self.choose(email).status_code, 400)

    def test_the_admin_chooses_a_password_with_no_code_and_is_signed_in(self):
        rid, email, code = self.added()
        r = self.choose(email)
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["access_token"])
        self.assertEqual(body["user"]["role"], "manufacturer")
        user = self.user_of(email)
        self.assertTrue(user.password_hash, "saved in the database")
        self.assertTrue(user.is_verified)
        self.assertEqual(client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}).status_code, 200)
        listed = [i["id"] for i in client.get(f"{API}/users/admin-invites", headers=_h(self.owner)).json()["invites"]]
        self.assertNotIn(rid, listed, "finished")
        self.assertFalse(self.first_time(email), "chosen once: the page now asks for the password")

    def test_afterwards_it_is_email_and_password_and_no_code_ever(self):
        rid, email, code = self.added()
        self.choose(email)
        self.inbox.sent.clear()
        self.assertEqual(self.sign_in(email).status_code, 200)
        self.assertEqual(self.sign_in(email, "some-other-password-1").status_code, 401)
        self.assertEqual(self.inbox.sent, [], "no email is sent for a sign-in")

    def test_the_first_password_can_only_be_chosen_once(self):
        rid, email, code = self.added()
        self.assertEqual(self.choose(email).status_code, 200)
        self.assertEqual(self.choose(email, "another-long-pass-2").status_code, 400)
        self.assertEqual(self.sign_in(email).status_code, 200, "the first password stands")

    def test_a_short_password_is_refused(self):
        rid, email, code = self.added()
        self.assertEqual(self.choose(email, "short").status_code, 422)
        self.assertTrue(self.first_time(email), "still waiting for a real one")
        self.assertEqual(self.choose(email).status_code, 200)

    def test_it_is_only_possible_for_24_hours_after_the_owner_confirmed(self):
        rid, email, code = self.added()
        self.db.query(AdminInvite).filter(AdminInvite.email == email).update({"verified_at": datetime.now(timezone.utc) - timedelta(hours=25)})
        self.db.commit()
        self.assertFalse(self.first_time(email))
        self.assertEqual(self.choose(email).status_code, 400)
        self.assertFalse(self.user_of(email).password_hash)

    def test_an_admin_who_already_has_a_password_cannot_have_it_replaced_without_a_code(self):
        rid, email, code = self.added()
        self.choose(email, "first-long-password-1")
        self.assertEqual(self.choose(email, "attacker-password-12").status_code, 400)
        self.assertEqual(self.sign_in(email, "first-long-password-1").status_code, 200)

    def test_a_suspended_admin_cannot_choose_a_password(self):
        rid, email, code = self.added()
        self.db.query(User).filter(User.email == email).update({"account_status": "SUSPENDED"})
        self.db.commit()
        self.assertFalse(self.first_time(email))
        self.assertEqual(self.choose(email).status_code, 400)

    def test_the_old_one_step_creation_paths_are_gone(self):
        rid, email, code = self.added()
        user = self.user_of(email)
        self.assertEqual(client.post(f"{API}/users/{user.id}/admin-code", headers=_h(self.owner)).status_code, 404)


class TestForgotPassword(InviteBase):
    def admin_with_password(self, password="first-long-password-1"):
        rid, email, code = self.added()
        self.choose(email, password)
        self.inbox.sent.clear()
        return email

    def test_the_admins_address_gets_a_code_and_a_stranger_gets_the_same_answer_and_nothing(self):
        email = self.admin_with_password()
        known, unknown = self.ask_reset(email), self.ask_reset("nobody-here@example.com")
        self.assertEqual((known.status_code, known.json()), (unknown.status_code, unknown.json()))
        self.assertEqual(len(self.inbox.sent), 1)
        self.assertEqual(self.inbox.sent[0][0], email)

    def test_only_an_admin_can_use_it_not_the_owner_a_dealer_or_a_farmer(self):
        for role in ("superadmin", "dealer", "customer", "distributor"):
            u = _partner(self, role, f"fp-{role}", parent=self.owner)
            self.db.query(User).filter(User.id == u.id).update({"email": f"{role}-{uuid.uuid4().hex[:6]}@example.com"})
            self.db.commit()
            self.ask_reset(self.db.query(User).filter(User.id == u.id).one().email)
        self.assertEqual(self.inbox.sent, [])

    def test_the_emailed_code_and_a_new_password_replace_the_old_one_in_the_database(self):
        email = self.admin_with_password()
        old_hash = self.user_of(email).password_hash
        self.ask_reset(email)
        r = self.choose(email, "second-long-password-2", code=self.inbox.code())
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["access_token"])
        self.assertNotEqual(self.user_of(email).password_hash, old_hash)
        self.assertEqual(self.sign_in(email, "first-long-password-1").status_code, 401)
        self.assertEqual(self.sign_in(email, "second-long-password-2").status_code, 200)

    def test_a_wrong_code_is_refused_and_five_burn_the_real_one(self):
        email = self.admin_with_password()
        self.ask_reset(email)
        real = self.inbox.code()
        wrong = "000000" if real != "000000" else "111111"
        for _ in range(5):
            self.assertEqual(self.choose(email, "second-long-password-2", code=wrong).status_code, 400)
        self.assertEqual(self.choose(email, "second-long-password-2", code=real).status_code, 400, "burned")
        self.assertEqual(self.sign_in(email, "first-long-password-1").status_code, 200, "the old password still stands")

    def test_a_code_works_once(self):
        email = self.admin_with_password()
        self.ask_reset(email)
        code = self.inbox.code()
        self.assertEqual(self.choose(email, "second-long-password-2", code=code).status_code, 200)
        self.assertEqual(self.choose(email, "third-long-password-3", code=code).status_code, 400)

    def test_a_short_password_is_refused_and_does_not_use_up_the_code(self):
        email = self.admin_with_password()
        self.ask_reset(email)
        code = self.inbox.code()
        self.assertEqual(self.choose(email, "short", code=code).status_code, 422)
        self.assertEqual(self.choose(email, "second-long-password-2", code=code).status_code, 200)

    def test_the_code_lasts_30_minutes(self):
        email = self.admin_with_password()
        self.ask_reset(email)
        code = self.inbox.code()
        self.db.query(AdminInvite).filter(AdminInvite.email == email, AdminInvite.purpose == "reset").update({"expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)})
        self.db.commit()
        self.assertEqual(self.choose(email, "second-long-password-2", code=code).status_code, 400)

    def test_a_new_request_replaces_the_old_code(self):
        email = self.admin_with_password()
        self.ask_reset(email)
        first = self.inbox.code()
        self.ask_reset(email)
        second = self.inbox.code()
        if first != second:
            self.assertEqual(self.choose(email, "second-long-password-2", code=first).status_code, 400)
        self.assertEqual(self.choose(email, "second-long-password-2", code=second).status_code, 200)

    def test_no_more_than_five_codes_an_hour(self):
        email = self.admin_with_password()
        for _ in range(8):
            self.ask_reset(email)
        self.assertEqual(len(self.inbox.sent), admin_invites.RESET_PER_HOUR)

    def test_an_admin_who_never_chose_a_password_can_also_use_it(self):
        rid, email, code = self.added()
        self.db.query(AdminInvite).filter(AdminInvite.email == email).update({"verified_at": datetime.now(timezone.utc) - timedelta(hours=30)})
        self.db.commit()
        self.assertFalse(self.first_time(email), "the 24 hours are over")
        self.inbox.sent.clear()
        self.ask_reset(email)
        self.assertEqual(self.choose(email, "first-long-password-1", code=self.inbox.code()).status_code, 200)

    def test_the_fixed_development_code_is_refused_when_real_email_is_set_up(self):
        from app.config import settings

        email = self.admin_with_password()
        self.ask_reset(email)
        with patch.object(settings, "EMAIL_BACKEND", "smtp"):
            self.assertEqual(self.choose(email, "second-long-password-2", code="123456").status_code, 400)

    def test_a_failing_email_service_does_not_show_in_the_answer(self):
        email = self.admin_with_password()
        with patch("app.services.email_service.send_email", side_effect=email_service.EmailNotSent("down")):
            r = self.ask_reset(email)
        self.assertEqual(r.status_code, 200)

    def test_an_owners_code_cannot_be_used_to_set_an_admins_password(self):
        email = self.admin_with_password()
        self.ask_reset(email)
        self.assertEqual(self.choose(self.owner.email or "x@example.com", "second-long-password-2", code=self.inbox.code()).status_code, 400)


class TestTheOwnersList(InviteBase):
    def test_resend_makes_a_new_code_and_the_old_one_stops_working(self):
        rid, email, old = self.started()
        self.assertEqual(client.post(f"{API}/users/admin-invites/{rid}/resend", headers=_h(self.owner)).status_code, 200)
        self.assertEqual(len(self.inbox.sent), 2)
        new = self.inbox.code()
        if new != old:
            self.assertEqual(self.verify(rid, old).status_code, 400)
        self.assertEqual(self.verify(rid, new).status_code, 200)

    def test_cancelling_an_invite_ends_it(self):
        rid, email, code = self.started()
        self.assertEqual(client.delete(f"{API}/users/admin-invites/{rid}", headers=_h(self.owner)).status_code, 200)
        self.assertEqual(self.verify(rid, code).status_code, 400)
        self.assertIsNone(self.user_of(email))


if __name__ == "__main__":
    unittest.main()
