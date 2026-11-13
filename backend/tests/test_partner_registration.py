"""Registering a distributor or a dealer: scan the QR, get the one-time password, type it with the mobile number, choose your own password, and only then
is there an account. Runs against the local development database."""
import os
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient

from app.main import app
from app.models import User
from app.models.partner_registration import PartnerRegistration
from app.services import partner_registration as pr
from test_web_portal_users import _h, _partner  # noqa: E402
from test_web_portal_hardening import MfaBase  # noqa: E402  (the base class only)

client = TestClient(app)
MINE = "My-Own-Pass-1"


def _digits():
    return f"90{uuid.uuid4().int % 10**8:08d}"


class RegBase(MfaBase):
    def setUp(self):
        cls = type(self)
        if getattr(cls, "sa", None) is None:
            cls.sa = _partner(self, "superadmin", "reg-root")
        self.admin = _partner(self, "manufacturer", "reg-admin", parent=self.sa)
        self.dist = _partner(self, "distributor", "reg-dist", parent=self.admin)

    # the admin's side
    def start(self, actor, role="dealer", phone=None, **extra):
        phone = phone or _digits()
        body = {"full_name": "Suresh Patil", "address": "Hadapsar, Pune", "phone_number": phone, "role": role, **extra}
        return client.post("/api/v1/users/registrations", json=body, headers=_h(actor)), phone

    def started(self, actor=None, role="dealer", **extra):
        r, phone = self.start(actor or self.dist, role, **extra)
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()["registration"]["id"], phone, r.json()["qr"]["token"]

    def look(self, actor, rid):
        r = client.get(f"/api/v1/users/registrations/{rid}", headers=_h(actor))
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["registration"]

    # the new person's side
    def scan(self, token):
        return client.post("/api/v1/auth/registration/scan", json={"token": token})

    def verify(self, token, phone, code):
        return client.post("/api/v1/auth/registration/verify", json={"token": token, "phone": phone, "code": code})

    def complete(self, token, ticket, password=MINE):
        return client.post("/api/v1/auth/registration/complete", json={"token": token, "ticket": ticket, "password": password})

    def scanned(self, actor=None):
        rid, phone, token = self.started(actor)
        self.assertEqual(self.scan(token).status_code, 200)
        code = self.look(actor or self.dist, rid)["password"]
        self.assertTrue(code)
        return rid, phone, token, code

    def finish(self, actor=None, role="dealer"):
        rid, phone, token = self.started(actor, role)
        self.scan(token)
        code = self.look(actor or self.dist, rid)["password"]
        ticket = self.verify(token, phone, code).json()["ticket"]
        r = self.complete(token, ticket)
        self.assertEqual(r.status_code, 200, r.text)
        self.db.expire_all()
        user = self.db.query(User).filter((User.phone == f"+91{phone}") | (User.phone_number == f"+91{phone}")).one()
        type(self).user_ids.append(user.id)
        return user, r.json()


class TestStartingARegistration(RegBase):
    def test_it_saves_what_was_typed_and_shows_a_qr_but_makes_no_account(self):
        r, phone = self.start(self.dist)
        self.assertEqual(r.status_code, 201, r.text)
        body = r.json()
        self.assertEqual(body["registration"]["status"], "WAITING")
        self.assertIsNone(body["registration"]["password"], "no password exists before the scan")
        self.assertTrue(len(body["qr"]["token"]) >= 20)
        self.assertEqual(self.db.query(User).filter(User.phone == f"+91{phone}").count(), 0, "nothing but a pending registration")

    def test_an_admin_registers_distributors_and_dealers_and_a_distributor_registers_dealers(self):
        for actor, role in ((self.admin, "distributor"), (self.admin, "dealer"), (self.dist, "dealer")):
            self.assertEqual(self.start(actor, role)[0].status_code, 201, role)

    def test_nobody_registers_above_themselves(self):
        self.assertEqual(self.start(self.dist, "distributor")[0].status_code, 403)
        dealer = _partner(self, "dealer", "reg-dealer", parent=self.dist)
        self.assertEqual(self.start(dealer, "dealer")[0].status_code, 403)
        self.assertEqual(self.start(self.admin, "manufacturer")[0].status_code, 403)

    def test_the_super_admin_cannot_register_anyone_this_way(self):
        self.assertIn(self.start(self.sa, "dealer")[0].status_code, (403,))

    def test_the_name_address_and_a_real_number_are_all_needed(self):
        self.assertEqual(self.start(self.dist, phone="12345")[0].status_code, 422)
        self.assertEqual(self.start(self.dist, address="")[0].status_code, 422)
        self.assertEqual(self.start(self.dist, full_name="")[0].status_code, 422)

    def test_a_number_that_already_has_an_account_is_refused_straight_away(self):
        user, _ = self.finish()
        r, _ = self.start(self.dist, phone=user.phone[-10:])
        self.assertEqual(r.status_code, 409)

    def test_a_dealer_can_be_registered_under_a_distributor_by_the_admin(self):
        r, _ = self.start(self.admin, "dealer", parent_user_id=str(self.dist.id))
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(self.start(self.admin, "dealer", parent_user_id=str(uuid.uuid4()))[0].status_code, 404)

    def test_starting_again_for_the_same_number_replaces_the_first(self):
        rid1, phone, token1 = self.started()
        r, _ = self.start(self.dist, phone=phone)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.scan(token1).status_code, 400, "the older QR is dead")


class TestScanningTheQr(RegBase):
    def test_scanning_greets_the_person_and_shows_nothing_secret(self):
        rid, phone, token = self.started()
        r = self.scan(token)
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["first_name"], "Suresh")
        self.assertEqual(body["role"], "dealer")
        self.assertEqual(body["registered_by"], self.dist.full_name)
        for secret in ("password", "code", "phone", "address", "ticket"):
            self.assertNotIn(secret, body)

    def test_the_password_appears_on_the_admin_page_only_once_the_qr_was_scanned_and_only_once(self):
        rid, phone, token = self.started()
        before = self.look(self.dist, rid)
        self.assertEqual((before["status"], before["password"]), ("WAITING", None))
        self.scan(token)
        shown = self.look(self.dist, rid)
        self.assertEqual(shown["status"], "SCANNED")
        self.assertRegex(shown["password"], r"^[A-Z0-9]{4}-[A-Z0-9]{4}$")
        self.assertIsNone(self.look(self.dist, rid)["password"], "shown once, then forgotten")

    def test_scanning_twice_does_not_make_a_second_password(self):
        rid, phone, token = self.started()
        self.scan(token)
        code = self.look(self.dist, rid)["password"]
        self.scan(token)
        self.assertIsNone(self.look(self.dist, rid)["password"])
        self.assertEqual(self.verify(token, phone, code).status_code, 200)

    def test_a_made_up_or_old_qr_is_refused(self):
        self.assertEqual(self.scan("x" * 30).status_code, 400)
        self.assertEqual(self.scan("short").status_code, 422)

    def test_an_expired_qr_cannot_be_scanned(self):
        rid, phone, token = self.started()
        self.db.query(PartnerRegistration).filter(PartnerRegistration.id == rid).update({"expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)})
        self.db.commit()
        self.assertEqual(self.scan(token).status_code, 400)
        self.assertEqual(self.look(self.dist, rid)["status"], "EXPIRED")


class TestTypingThePassword(RegBase):
    def test_nothing_works_before_the_qr_was_scanned(self):
        rid, phone, token = self.started()
        self.assertEqual(self.verify(token, phone, "AAAA-AAAA").status_code, 400)
        self.assertEqual(self.complete(token, "x" * 20).status_code, 400)

    def test_a_right_number_and_password_give_a_ticket(self):
        rid, phone, token, code = self.scanned()
        r = self.verify(token, phone, code)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["ticket"])

    def test_the_password_is_read_out_so_case_and_the_dash_do_not_matter(self):
        rid, phone, token, code = self.scanned()
        self.assertEqual(self.verify(token, f"+91 {phone[:5]}-{phone[5:]}", code.lower().replace("-", " ")).status_code, 200)

    def test_a_wrong_number_or_a_wrong_password_is_refused_and_counted_and_five_burn_the_qr(self):
        rid, phone, token, code = self.scanned()
        for _ in range(4):
            r = self.verify(token, phone, "ZZZZ-ZZZZ")
            self.assertEqual(r.status_code, 400)
            self.assertNotIn("blocked", r.json()["detail"])
        burned = self.verify(token, _digits(), code)          # right password, wrong number: still a wrong try
        self.assertEqual(burned.status_code, 400)
        self.assertIn("blocked", burned.json()["detail"])
        self.assertEqual(self.verify(token, phone, code).status_code, 400, "even the right pair is refused once it is burned")
        self.assertEqual(self.look(self.dist, rid)["status"], "BLOCKED")

    def test_an_old_password_does_not_work_after_a_new_one_is_made(self):
        rid, phone, token, old = self.scanned()
        r = client.post(f"/api/v1/users/registrations/{rid}/password", headers=_h(self.dist))
        self.assertEqual(r.status_code, 200, r.text)
        fresh = r.json()["registration"]["password"]
        self.assertTrue(fresh and fresh != old)
        self.assertEqual(self.verify(token, phone, old).status_code, 400)
        self.assertEqual(self.verify(token, phone, fresh).status_code, 200)

    def test_an_expired_password_is_refused(self):
        rid, phone, token, code = self.scanned()
        self.db.query(PartnerRegistration).filter(PartnerRegistration.id == rid).update({"code_expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)})
        self.db.commit()
        r = self.verify(token, phone, code)
        self.assertEqual(r.status_code, 400)
        self.assertIn("expired", r.json()["detail"])


class TestChoosingYourOwnPassword(RegBase):
    def test_only_now_is_the_account_made_with_the_details_the_admin_typed(self):
        user, session = self.finish()
        self.assertEqual((user.full_name, user.role, user.address), ("Suresh Patil", "dealer", "Hadapsar, Pune"))
        self.assertEqual(user.parent_user_id, self.dist.id)
        self.assertEqual(user.hierarchy_path, f"{self.dist.hierarchy_path}/{user.id}")
        self.assertIsNotNone(user.brand_id, "a partner account always belongs to a brand")
        self.assertTrue(session["access_token"] and session["refresh_token"])
        self.assertEqual(client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {session['access_token']}"}).status_code, 200)

    def test_they_sign_in_afterwards_with_the_mobile_number_and_the_password_they_chose_not_the_one_sent(self):
        rid, phone, token, code = self.scanned()
        ticket = self.verify(token, phone, code).json()["ticket"]
        self.assertEqual(self.complete(token, ticket).status_code, 200)
        self.db.expire_all()
        type(self).user_ids.append(self.db.query(User).filter(User.phone == f"+91{phone}").one().id)
        self.assertEqual(client.post("/api/v1/auth/login-password", json={"phone_number": phone, "password": MINE}).status_code, 200)
        self.assertEqual(client.post("/api/v1/auth/login-password", json={"phone_number": phone, "password": code}).status_code, 401)

    def test_the_admin_sees_it_completed_and_the_qr_is_used_up(self):
        rid, phone, token, code = self.scanned()
        ticket = self.verify(token, phone, code).json()["ticket"]
        self.complete(token, ticket)
        self.db.expire_all()
        type(self).user_ids.append(self.db.query(User).filter(User.phone == f"+91{phone}").one().id)
        self.assertEqual(self.look(self.dist, rid)["status"], "COMPLETED")
        self.assertEqual(self.scan(token).status_code, 400)
        self.assertEqual(self.complete(token, ticket).status_code, 400)

    def test_a_short_password_is_refused_and_nothing_is_made(self):
        rid, phone, token, code = self.scanned()
        ticket = self.verify(token, phone, code).json()["ticket"]
        self.assertEqual(self.complete(token, ticket, "short").status_code, 422)
        self.assertEqual(self.db.query(User).filter(User.phone == f"+91{phone}").count(), 0)
        self.assertEqual(self.complete(token, ticket).status_code, 200, "the same ticket still works afterwards")
        self.db.expire_all()
        type(self).user_ids.append(self.db.query(User).filter(User.phone == f"+91{phone}").one().id)

    def test_a_wrong_or_expired_ticket_is_refused(self):
        rid, phone, token, code = self.scanned()
        ticket = self.verify(token, phone, code).json()["ticket"]
        self.assertEqual(self.complete(token, "wrong-ticket-value-1234").status_code, 400)
        self.db.query(PartnerRegistration).filter(PartnerRegistration.id == rid).update({"ticket_expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)})
        self.db.commit()
        self.assertEqual(self.complete(token, ticket).status_code, 400)

    def test_without_a_verified_password_there_is_no_ticket_to_complete_with(self):
        rid, phone, token, code = self.scanned()
        self.assertEqual(self.complete(token, "made-up-ticket-0123456789").status_code, 400)
        self.assertEqual(self.db.query(User).filter(User.phone == f"+91{phone}").count(), 0)

    def test_if_the_number_got_an_account_in_the_meantime_it_is_refused(self):
        rid, phone, token, code = self.scanned()
        ticket = self.verify(token, phone, code).json()["ticket"]
        other = _partner(self, "customer", "reg-late")
        self.db.query(User).filter(User.id == other.id).update({"phone": f"+91{phone}", "phone_number": f"+91{phone}"})
        self.db.commit()
        self.assertEqual(self.complete(token, ticket).status_code, 409)

    def test_a_distributor_can_be_registered_too(self):
        user, _ = self.finish(self.admin, "distributor")
        self.assertEqual((user.role, user.parent_user_id), ("distributor", self.admin.id))


class TestTheAdminsPage(RegBase):
    def test_a_new_qr_kills_the_old_one_and_starts_the_scan_again(self):
        rid, phone, token, code = self.scanned()
        r = client.post(f"/api/v1/users/registrations/{rid}/qr", headers=_h(self.dist))
        self.assertEqual(r.status_code, 200, r.text)
        new = r.json()["qr"]["token"]
        self.assertNotEqual(new, token)
        self.assertEqual(r.json()["registration"]["status"], "WAITING")
        self.assertEqual(self.scan(token).status_code, 400)
        self.assertEqual(self.verify(token, phone, code).status_code, 400)
        self.assertEqual(self.scan(new).status_code, 200)

    def test_cancelling_ends_it(self):
        rid, phone, token = self.started()
        self.assertEqual(client.delete(f"/api/v1/users/registrations/{rid}", headers=_h(self.dist)).status_code, 200)
        self.assertEqual(self.scan(token).status_code, 400)
        ids = [r["id"] for r in client.get("/api/v1/users/registrations", headers=_h(self.dist)).json()["registrations"]]
        self.assertNotIn(rid, ids)

    def test_the_list_shows_what_is_not_finished_and_only_the_callers_own(self):
        rid1, _, _ = self.started()
        other = _partner(self, "distributor", "reg-other", parent=self.admin)
        rid2, _, _ = self.started(other)
        mine = {r["id"]: r for r in client.get("/api/v1/users/registrations", headers=_h(self.dist)).json()["registrations"]}
        self.assertIn(rid1, mine)
        self.assertNotIn(rid2, mine)
        self.assertEqual(mine[rid1]["status"], "WAITING")
        both = {r["id"] for r in client.get("/api/v1/users/registrations", headers=_h(self.admin)).json()["registrations"]}
        self.assertTrue({rid1, rid2} <= both, "the admin sees everything under it")

    def test_a_finished_registration_is_not_listed(self):
        rid, phone, token, code = self.scanned()
        ticket = self.verify(token, phone, code).json()["ticket"]
        self.complete(token, ticket)
        self.db.expire_all()
        type(self).user_ids.append(self.db.query(User).filter(User.phone == f"+91{phone}").one().id)
        ids = [r["id"] for r in client.get("/api/v1/users/registrations", headers=_h(self.dist)).json()["registrations"]]
        self.assertNotIn(rid, ids)

    def test_someone_elses_registration_cannot_be_read_changed_or_cancelled(self):
        rid, _, _ = self.started()
        stranger = _partner(self, "distributor", "reg-stranger", parent=self.admin)
        for call in (client.get, client.delete):
            self.assertEqual(call(f"/api/v1/users/registrations/{rid}", headers=_h(stranger)).status_code, 404)
        self.assertEqual(client.post(f"/api/v1/users/registrations/{rid}/qr", headers=_h(stranger)).status_code, 404)
        self.assertEqual(client.get("/api/v1/users/registrations/not-an-id", headers=_h(self.dist)).status_code, 404)

    def test_the_password_cannot_be_remade_before_the_scan(self):
        rid, _, _ = self.started()
        self.assertEqual(client.post(f"/api/v1/users/registrations/{rid}/password", headers=_h(self.dist)).status_code, 409)

    def test_only_a_signed_in_partner_can_use_these_pages(self):
        self.assertEqual(client.post("/api/v1/users/registrations", json={}).status_code, 401)
        farmer = _partner(self, "customer", "reg-farmer", parent=self.dist)
        self.assertEqual(client.get("/api/v1/users/registrations", headers=_h(farmer)).status_code, 403)


class TestTheCodeAlphabet(unittest.TestCase):
    def test_codes_have_no_lookalike_characters_and_are_not_repeated(self):
        codes = {pr.new_code() for _ in range(200)}
        self.assertGreater(len(codes), 195)
        for c in codes:
            self.assertRegex(c, r"^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$")


if __name__ == "__main__":
    unittest.main()
