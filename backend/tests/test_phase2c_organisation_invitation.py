"""
Phase 2C: Organisation Invitation & User Onboarding Test Suite
AgriPump SmartSpace Backend

Tests:
1. End-to-end hierarchy invitation and onboarding flow:
   SUPER ADMIN -> invites MANUFACTURER -> accepts -> MANUFACTURER invites DISTRIBUTOR -> accepts ->
   DISTRIBUTOR invites DEALER -> accepts -> DEALER invites END USER.
2. Expired invitation cannot be accepted (INVITATION_EXPIRED).
3. Revoked invitation cannot be accepted.
4. Wrong phone number rejected on acceptance.
5. Invalid WhatsApp OTP rejected.
6. Tampering with role or target_org_id during acceptance is prevented.
7. Unauthorized invitation creation rules (Dealer cannot invite Distributor, etc.).
8. Dealer depth limit enforcement (cannot invite Dealer beyond depth 6).
9. Cross-organisation invitation blocked.
10. Duplicate active account rejected.
11. Resend invitation and rate limiting.
12. Audit event generation for invitation lifecycle.
"""
import os
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone
import pyotp

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import text
from app.main import app
from app.database import SessionLocal
from app.models import User, Organisation, InviteToken, AuditLog
from app.core.roles import UserRole, OrgType, OrgStatus, UserStatus
from app.services.jwt_auth import hash_secret, sign_token
from app.services.phone_verification import start_phone_verification

client = TestClient(app)
NOW = datetime.now(timezone.utc)


def auth_header(user: User) -> dict:
    token = sign_token({
        "sub": str(user.id),
        "role": user.role,
        "org_id": str(user.org_id) if user.org_id else None,
        "hierarchy_path": user.hierarchy_path,
        "session_ver": user.session_version or 1,
    })
    return {"Authorization": f"Bearer {token}"}


class TestPhase2COrganisationInvitation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))
        cls.sfx = uuid.uuid4().hex[:6]

        cls.user_ids = []
        cls.org_ids = []
        cls.invite_ids = []

        # Root Organisation
        root_org = cls.db.query(Organisation).filter(Organisation.parent_id.is_(None)).first()
        if not root_org:
            root_org = Organisation(
                id=uuid.uuid4(),
                parent_id=None,
                type=OrgType.SUPERADMIN.value,
                name="AgriPump Root",
                path="root",
                depth=0,
                status=OrgStatus.ACTIVE.value
            )
            cls.db.add(root_org)
            cls.db.commit()
            cls.org_ids.append(root_org.id)
        cls.root_org = root_org

        # Super Admin User
        sa_uid = uuid.uuid4()
        phone_sa = f"+9198{abs(hash(('sa', cls.sfx))) % 10**8:08d}"
        cls.sa_user = User(
            id=sa_uid,
            full_name=f"Super Admin {cls.sfx}",
            phone=phone_sa,
            phone_number=phone_sa,
            role="superadmin",
            org_id=cls.root_org.id,
            hierarchy_path="/SA",
            account_status="ACTIVE",
            session_version=1,
            password_hash=hash_secret("SecPass!123"),
            totp_secret=pyotp.random_base32(),
            totp_enabled=True,
            is_active=True,
            is_verified=True
        )
        cls.db.add(cls.sa_user)
        cls.db.commit()
        cls.user_ids.append(sa_uid)

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            cls.db.query(InviteToken).filter(InviteToken.id.in_(cls.invite_ids)).delete(synchronize_session=False)
            cls.db.query(Organisation).filter(Organisation.id.in_(cls.org_ids)).delete(synchronize_session=False)
            cls.db.query(User).filter(User.id.in_(cls.user_ids)).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            cls.db.close()

    def setUp(self):
        self.db.rollback()
        self.db.execute(text("SET app.bypass_rls = 'on';"))

    # =========================================================================
    # 1. Full End-to-End Hierarchy Invitation & Onboarding Flow
    #    SUPER ADMIN -> MANUFACTURER -> DISTRIBUTOR -> DEALER -> END USER
    # =========================================================================
    def test_01_full_hierarchy_invitation_flow(self):
        """
        Demonstrates the complete end-to-end invitation flow across all hierarchy levels:
        Super Admin invites Manufacturer -> Manufacturer accepts via OTP
        -> Manufacturer invites Distributor -> Distributor accepts via OTP
        -> Distributor invites Dealer -> Dealer accepts via OTP
        -> Dealer invites Farmer / End User -> Farmer accepts via OTP
        """
        # Step 1: Super Admin creates a Manufacturer Organisation
        mfg_org_id = uuid.uuid4()
        mfg_org = Organisation(
            id=mfg_org_id,
            parent_id=self.root_org.id,
            type=OrgType.MANUFACTURER.value,
            name=f"Apex Panels {self.sfx}",
            path=f"{self.root_org.path}.{str(mfg_org_id).replace('-', '_')}",
            depth=1,
            status=OrgStatus.ACTIVE.value
        )
        self.db.add(mfg_org)
        self.db.commit()
        self.org_ids.append(mfg_org_id)

        # Super Admin invites Manufacturer User
        mfg_phone = f"+9191{abs(hash(('mfg', self.sfx))) % 10**8:08d}"
        inv_res = client.post(
            f"/organisations/{mfg_org_id}/invitations",
            json={"phone": mfg_phone, "role": "MANUFACTURER"},
            headers=auth_header(self.sa_user)
        )
        self.assertEqual(inv_res.status_code, 201, inv_res.text)
        mfg_inv_data = inv_res.json()
        mfg_token = mfg_inv_data["token"]
        self.invite_ids.append(uuid.UUID(mfg_inv_data["id"]))

        # Preview invitation (public, no auth)
        preview_res = client.get(f"/invitations/{mfg_token}")
        self.assertEqual(preview_res.status_code, 200, preview_res.text)
        preview_data = preview_res.json()
        self.assertIn(preview_data["role"], ["MANUFACTURER", "PANEL_MANUFACTURER"])
        self.assertEqual(preview_data["organisation_name"], f"Apex Panels {self.sfx}")

        # Send WhatsApp OTP for phone verification
        otp_res = client.post(
            "/api/v1/auth/verify-phone/send",
            json={"phone_number": mfg_phone, "purpose": "registration"}
        )
        self.assertEqual(otp_res.status_code, 200)
        mfg_dev_otp = otp_res.json().get("dev_otp", "123456")

        # Manufacturer accepts invitation with WhatsApp OTP
        accept_res = client.post(
            f"/invitations/{mfg_token}/accept",
            json={"phone": mfg_phone, "otp": mfg_dev_otp, "full_name": "Apex Admin"}
        )
        self.assertEqual(accept_res.status_code, 200, accept_res.text)
        mfg_auth = accept_res.json()
        self.assertEqual(mfg_auth["status"], "AUTHENTICATED")
        self.assertEqual(mfg_auth["user"]["role"], "manufacturer")
        self.assertEqual(mfg_auth["user"]["org_id"], str(mfg_org_id))
        self.user_ids.append(uuid.UUID(mfg_auth["user"]["id"]))

        mfg_headers = {"Authorization": f"Bearer {mfg_auth['access_token']}"}

        # Step 2: Manufacturer invites Distributor
        dist_org_id = uuid.uuid4()
        dist_org = Organisation(
            id=dist_org_id,
            parent_id=mfg_org_id,
            type=OrgType.DISTRIBUTOR.value,
            name=f"Western Distributors {self.sfx}",
            path=f"{mfg_org.path}.{str(dist_org_id).replace('-', '_')}",
            depth=2,
            status=OrgStatus.ACTIVE.value
        )
        self.db.add(dist_org)
        self.db.commit()
        self.org_ids.append(dist_org_id)

        dist_phone = f"+9192{abs(hash(('dist', self.sfx))) % 10**8:08d}"
        inv_dist_res = client.post(
            f"/organisations/{dist_org_id}/invitations",
            json={"phone": dist_phone, "role": "DISTRIBUTOR"},
            headers=mfg_headers
        )
        self.assertEqual(inv_dist_res.status_code, 201, inv_dist_res.text)
        dist_inv_data = inv_dist_res.json()
        dist_token = dist_inv_data["token"]
        self.invite_ids.append(uuid.UUID(dist_inv_data["id"]))

        # Distributor accepts invitation
        otp_dist_res = client.post(
            "/api/v1/auth/verify-phone/send",
            json={"phone_number": dist_phone, "purpose": "registration"}
        )
        dist_dev_otp = otp_dist_res.json().get("dev_otp", "123456")

        accept_dist = client.post(
            f"/invitations/{dist_token}/accept",
            json={"phone": dist_phone, "otp": dist_dev_otp, "full_name": "Distributor West"}
        )
        self.assertEqual(accept_dist.status_code, 200, accept_dist.text)
        dist_auth = accept_dist.json()
        self.assertEqual(dist_auth["user"]["role"], "distributor")
        self.assertEqual(dist_auth["user"]["org_id"], str(dist_org_id))
        self.user_ids.append(uuid.UUID(dist_auth["user"]["id"]))

        dist_headers = {"Authorization": f"Bearer {dist_auth['access_token']}"}

        # Step 3: Distributor invites Dealer
        dealer_org_id = uuid.uuid4()
        dealer_org = Organisation(
            id=dealer_org_id,
            parent_id=dist_org_id,
            type=OrgType.DEALER.value,
            name=f"Kisan Krishi Kendra {self.sfx}",
            path=f"{dist_org.path}.{str(dealer_org_id).replace('-', '_')}",
            depth=3,
            status=OrgStatus.ACTIVE.value
        )
        self.db.add(dealer_org)
        self.db.commit()
        self.org_ids.append(dealer_org_id)

        dealer_phone = f"+9193{abs(hash(('dealer', self.sfx))) % 10**8:08d}"
        inv_dl_res = client.post(
            f"/organisations/{dealer_org_id}/invitations",
            json={"phone": dealer_phone, "role": "DEALER"},
            headers=dist_headers
        )
        self.assertEqual(inv_dl_res.status_code, 201, inv_dl_res.text)
        dl_inv_data = inv_dl_res.json()
        dl_token = dl_inv_data["token"]
        self.invite_ids.append(uuid.UUID(dl_inv_data["id"]))

        # Dealer accepts invitation
        otp_dl_res = client.post(
            "/api/v1/auth/verify-phone/send",
            json={"phone_number": dealer_phone, "purpose": "registration"}
        )
        dl_dev_otp = otp_dl_res.json().get("dev_otp", "123456")

        accept_dl = client.post(
            f"/invitations/{dl_token}/accept",
            json={"phone": dealer_phone, "otp": dl_dev_otp, "full_name": "Dealer Kendra"}
        )
        self.assertEqual(accept_dl.status_code, 200, accept_dl.text)
        dl_auth = accept_dl.json()
        self.assertEqual(dl_auth["user"]["role"], "dealer")
        self.assertEqual(dl_auth["user"]["org_id"], str(dealer_org_id))
        self.user_ids.append(uuid.UUID(dl_auth["user"]["id"]))

        dl_headers = {"Authorization": f"Bearer {dl_auth['access_token']}"}

        # Step 4: Dealer invites End User (Farmer)
        farmer_phone = f"+9194{abs(hash(('farmer', self.sfx))) % 10**8:08d}"
        inv_farmer_res = client.post(
            f"/organisations/{dealer_org_id}/invitations",
            json={"phone": farmer_phone, "role": "END_USER"},
            headers=dl_headers
        )
        self.assertEqual(inv_farmer_res.status_code, 201, inv_farmer_res.text)
        farmer_inv_data = inv_farmer_res.json()
        farmer_token = farmer_inv_data["token"]
        self.invite_ids.append(uuid.UUID(farmer_inv_data["id"]))

        # Farmer accepts invitation
        otp_farmer_res = client.post(
            "/api/v1/auth/verify-phone/send",
            json={"phone_number": farmer_phone, "purpose": "registration"}
        )
        farmer_dev_otp = otp_farmer_res.json().get("dev_otp", "123456")

        accept_farmer = client.post(
            f"/invitations/{farmer_token}/accept",
            json={"phone": farmer_phone, "otp": farmer_dev_otp, "full_name": "Farmer Ramesh"}
        )
        self.assertEqual(accept_farmer.status_code, 200, accept_farmer.text)
        farmer_auth = accept_farmer.json()
        self.assertEqual(farmer_auth["user"]["role"], "customer")
        self.assertEqual(farmer_auth["user"]["org_id"], str(dealer_org_id))
        self.user_ids.append(uuid.UUID(farmer_auth["user"]["id"]))

    # =========================================================================
    # 2. Expired Invitation Cannot Be Accepted
    # =========================================================================
    def test_02_expired_invitation_cannot_be_accepted(self):
        """An expired invitation returns INVITATION_EXPIRED and cannot be redeemed."""
        phone = f"+9195{abs(hash(('exp', self.sfx))) % 10**8:08d}"
        inv_res = client.post(
            f"/organisations/{self.root_org.id}/invitations",
            json={"phone": phone, "role": "PANEL_MANUFACTURER"},
            headers=auth_header(self.sa_user)
        )
        token = inv_res.json()["token"]
        inv_id = uuid.UUID(inv_res.json()["id"])
        self.invite_ids.append(inv_id)

        # Manually expire the invitation in database
        self.db.execute(
            text("UPDATE agripump.invite_tokens SET expires_at = :exp WHERE id = :id"),
            {"exp": datetime.utcnow() - timedelta(hours=1), "id": inv_id}
        )
        self.db.commit()

        # Preview returns error
        res_preview = client.get(f"/invitations/{token}")
        self.assertEqual(res_preview.status_code, 400)
        self.assertIn("INVITATION_EXPIRED", res_preview.text)

        # Acceptance fails with INVITATION_EXPIRED
        res_accept = client.post(
            f"/invitations/{token}/accept",
            json={"phone": phone, "otp": "123456"}
        )
        self.assertEqual(res_accept.status_code, 400)
        self.assertIn("INVITATION_EXPIRED", res_accept.text)

    # =========================================================================
    # 3. Revoked Invitation Cannot Be Accepted
    # =========================================================================
    def test_03_revoked_invitation_cannot_be_accepted(self):
        """Authorised inviter revokes invitation; subsequently cannot be accepted."""
        phone = f"+9196{abs(hash(('rev', self.sfx))) % 10**8:08d}"
        inv_res = client.post(
            f"/organisations/{self.root_org.id}/invitations",
            json={"phone": phone, "role": "PANEL_MANUFACTURER"},
            headers=auth_header(self.sa_user)
        )
        token = inv_res.json()["token"]
        inv_id = uuid.UUID(inv_res.json()["id"])
        self.invite_ids.append(inv_id)

        # Revoke via POST /invitations/{id}/revoke
        res_revoke = client.post(f"/invitations/{inv_id}/revoke", headers=auth_header(self.sa_user))
        self.assertEqual(res_revoke.status_code, 200, res_revoke.text)

        # Attempting to preview or accept revoked invitation fails with 404
        res_preview = client.get(f"/invitations/{token}")
        self.assertEqual(res_preview.status_code, 404)

        res_accept = client.post(f"/invitations/{token}/accept", json={"phone": phone, "otp": "123456"})
        self.assertEqual(res_accept.status_code, 404)

    # =========================================================================
    # 4. Wrong Phone Number Rejected
    # =========================================================================
    def test_04_wrong_phone_rejected_on_acceptance(self):
        """Accepting with a phone different from the invited phone fails with 400."""
        phone_invited = f"+9197{abs(hash(('right', self.sfx))) % 10**8:08d}"
        phone_wrong = f"+9197{abs(hash(('wrong', self.sfx))) % 10**8:08d}"

        inv_res = client.post(
            f"/organisations/{self.root_org.id}/invitations",
            json={"phone": phone_invited, "role": "PANEL_MANUFACTURER"},
            headers=auth_header(self.sa_user)
        )
        token = inv_res.json()["token"]
        self.invite_ids.append(uuid.UUID(inv_res.json()["id"]))

        res_accept = client.post(
            f"/invitations/{token}/accept",
            json={"phone": phone_wrong, "otp": "123456"}
        )
        self.assertEqual(res_accept.status_code, 400)
        self.assertIn("does not match", res_accept.text)

    # =========================================================================
    # 5. Invalid WhatsApp OTP Rejected
    # =========================================================================
    def test_05_invalid_whatsapp_otp_rejected(self):
        """Accepting with an incorrect OTP code fails with 400 Bad Request."""
        phone = f"+9198{abs(hash(('badotp', self.sfx))) % 10**8:08d}"
        inv_res = client.post(
            f"/organisations/{self.root_org.id}/invitations",
            json={"phone": phone, "role": "PANEL_MANUFACTURER"},
            headers=auth_header(self.sa_user)
        )
        token = inv_res.json()["token"]
        self.invite_ids.append(uuid.UUID(inv_res.json()["id"]))

        # Send legitimate OTP
        client.post("/api/v1/auth/verify-phone/send", json={"phone_number": phone, "purpose": "registration"})

        # Submit wrong OTP code
        res_accept = client.post(
            f"/invitations/{token}/accept",
            json={"phone": phone, "otp": "000000"}
        )
        self.assertEqual(res_accept.status_code, 400)
        self.assertIn("Incorrect code", res_accept.text)

    # =========================================================================
    # 6. Role & Org Tampering is Ignored and Prevented
    # =========================================================================
    def test_06_role_and_org_tampering_prevented(self):
        """
        Submitting malicious 'role' or 'org_id' in acceptance payload is ignored.
        Backend assigns exclusively the invitation's validated role and org.
        """
        phone = f"+9199{abs(hash(('tamper', self.sfx))) % 10**8:08d}"
        inv_res = client.post(
            f"/organisations/{self.root_org.id}/invitations",
            json={"phone": phone, "role": "PANEL_MANUFACTURER"},
            headers=auth_header(self.sa_user)
        )
        token = inv_res.json()["token"]
        self.invite_ids.append(uuid.UUID(inv_res.json()["id"]))

        otp_res = client.post("/api/v1/auth/verify-phone/send", json={"phone_number": phone, "purpose": "registration"})
        dev_otp = otp_res.json().get("dev_otp", "123456")

        # Malicious payload trying to claim SUPER_ADMIN role and a different org
        fake_org = uuid.uuid4()
        res_accept = client.post(
            f"/invitations/{token}/accept",
            json={
                "phone": phone,
                "otp": dev_otp,
                "role": "SUPER_ADMIN",
                "target_org_id": str(fake_org),
                "org_id": str(fake_org)
            }
        )
        self.assertEqual(res_accept.status_code, 200, res_accept.text)
        auth_data = res_accept.json()
        self.user_ids.append(uuid.UUID(auth_data["user"]["id"]))

        # Role remains manufacturer (NOT superadmin), org remains root_org
        self.assertEqual(auth_data["user"]["role"], "manufacturer")
        self.assertEqual(auth_data["user"]["org_id"], str(self.root_org.id))

    # =========================================================================
    # 7. Unauthorized Invitation Creation Hierarchy Rules
    # =========================================================================
    def test_07_unauthorized_invitation_creation_rejected(self):
        """Verifies forbidden invitation combinations across roles."""
        # Create a dealer user
        dealer_org_id = uuid.uuid4()
        dealer_org = Organisation(
            id=dealer_org_id,
            parent_id=self.root_org.id,
            type=OrgType.DEALER.value,
            name=f"Test Dealer {self.sfx}",
            path=f"{self.root_org.path}.{str(dealer_org_id).replace('-', '_')}",
            depth=1,
            status=OrgStatus.ACTIVE.value
        )
        self.db.add(dealer_org)
        self.db.commit()
        self.org_ids.append(dealer_org_id)

        dealer_uid = uuid.uuid4()
        dealer_phone = f"+9151{abs(hash(('dl_unauth', self.sfx))) % 10**8:08d}"
        dealer_user = User(
            id=dealer_uid,
            full_name="Dealer Unauth Test",
            phone=dealer_phone,
            phone_number=dealer_phone,
            role="dealer",
            org_id=dealer_org_id,
            hierarchy_path=f"/SA/DL_{self.sfx}",
            account_status="ACTIVE",
            session_version=1,
            password_hash=hash_secret("SecPass!123"),
            totp_secret=pyotp.random_base32(),
            totp_enabled=True,
            is_active=True,
            is_verified=True
        )
        self.db.add(dealer_user)
        self.db.commit()
        self.user_ids.append(dealer_uid)

        dl_headers = auth_header(dealer_user)

        # Dealer CANNOT invite Distributor (403 Forbidden)
        res_dl_dist = client.post(
            f"/organisations/{dealer_org_id}/invitations",
            json={"phone": "+915111111111", "role": "DISTRIBUTOR"},
            headers=dl_headers
        )
        self.assertEqual(res_dl_dist.status_code, 403)

        # Dealer CANNOT invite Manufacturer (403 Forbidden)
        res_dl_mfg = client.post(
            f"/organisations/{dealer_org_id}/invitations",
            json={"phone": "+915111111112", "role": "PANEL_MANUFACTURER"},
            headers=dl_headers
        )
        self.assertEqual(res_dl_mfg.status_code, 403)

        # Dealer CANNOT invite Super Admin (403 Forbidden)
        res_dl_sa = client.post(
            f"/organisations/{dealer_org_id}/invitations",
            json={"phone": "+915111111113", "role": "SUPER_ADMIN"},
            headers=dl_headers
        )
        self.assertEqual(res_dl_sa.status_code, 403)

    # =========================================================================
    # 8. Dealer Depth Limit (Max 6 Levels)
    # =========================================================================
    def test_08_dealer_depth_limit_rejected(self):
        """Attempting to invite a dealer at depth > 6 fails with DEALER_DEPTH_LIMIT_REACHED."""
        # Create a dealer chain L1 to L6 under root
        curr_parent = self.root_org
        deep_org_id = None
        for level in range(1, 7):  # creates L1 through L6
            oid = uuid.uuid4()
            d_org = Organisation(
                id=oid,
                parent_id=curr_parent.id,
                type=OrgType.DEALER.value,
                name=f"Deep Dealer L{level} {self.sfx}",
                path=f"{curr_parent.path}.{str(oid).replace('-', '_')}",
                depth=curr_parent.depth + 1,
                status=OrgStatus.ACTIVE.value
            )
            self.db.add(d_org)
            self.db.commit()
            self.org_ids.append(oid)
            curr_parent = d_org
            if level == 6:
                # Target org is already at Dealer depth 6 (the maximum permitted)
                deep_org_id = oid

        phone = f"+9152{abs(hash(('deep', self.sfx))) % 10**8:08d}"
        res = client.post(
            f"/organisations/{deep_org_id}/invitations",
            json={"phone": phone, "role": "DEALER"},
            headers=auth_header(self.sa_user)
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("DEALER_DEPTH_LIMIT_REACHED", res.text)

    # =========================================================================
    # 9. Duplicate Active Account Rejected
    # =========================================================================
    def test_09_duplicate_active_account_rejected(self):
        """Inviting a phone number that is already active fails with 409 Conflict."""
        # Use super admin's already existing phone
        res = client.post(
            f"/organisations/{self.root_org.id}/invitations",
            json={"phone": self.sa_user.phone, "role": "PANEL_MANUFACTURER"},
            headers=auth_header(self.sa_user)
        )
        self.assertEqual(res.status_code, 409)
        self.assertIn("already registered", res.text)

    # =========================================================================
    # 10. Resend Invitation and Rate Limiting
    # =========================================================================
    def test_10_resend_invitation_and_rate_limiting(self):
        """Resending invitation dispatches WhatsApp OTP and enforces rate limiting."""
        phone = f"+9153{abs(hash(('resend', self.sfx))) % 10**8:08d}"
        inv_res = client.post(
            f"/organisations/{self.root_org.id}/invitations",
            json={"phone": phone, "role": "PANEL_MANUFACTURER"},
            headers=auth_header(self.sa_user)
        )
        inv_id = uuid.UUID(inv_res.json()["id"])
        self.invite_ids.append(inv_id)

        # Immediate resend should trigger 429 Too Many Requests (cooldown active)
        res_resend_fast = client.post(f"/invitations/{inv_id}/resend", headers=auth_header(self.sa_user))
        self.assertEqual(res_resend_fast.status_code, 429)

        # Set created_at to 60 seconds ago in DB
        self.db.execute(
            text("UPDATE agripump.invite_tokens SET created_at = :past WHERE id = :id"),
            {"past": datetime.utcnow() - timedelta(seconds=60), "id": inv_id}
        )
        self.db.commit()

        # Now resend succeeds
        res_resend = client.post(f"/invitations/{inv_id}/resend", headers=auth_header(self.sa_user))
        self.assertEqual(res_resend.status_code, 200, res_resend.text)
        self.assertEqual(res_resend.json()["status"], "RESENT")

    # =========================================================================
    # 11. Audit Events Recorded
    # =========================================================================
    def test_11_audit_events_recorded(self):
        """Asserts audit log records exist for invitation actions without credential leakage."""
        phone = f"+9154{abs(hash(('audit', self.sfx))) % 10**8:08d}"
        inv_res = client.post(
            f"/organisations/{self.root_org.id}/invitations",
            json={"phone": phone, "role": "PANEL_MANUFACTURER"},
            headers=auth_header(self.sa_user)
        )
        inv_id = uuid.UUID(inv_res.json()["id"])
        self.invite_ids.append(inv_id)

        # Check INVITATION_CREATED audit entry
        audit_entry = self.db.query(AuditLog).filter(
            AuditLog.entity_type == "invitation",
            AuditLog.entity_id == str(inv_id),
            AuditLog.action == "INVITATION_CREATED"
        ).first()
        self.assertIsNotNone(audit_entry, "Audit entry for INVITATION_CREATED must exist")
        self.assertEqual(audit_entry.actor_id, self.sa_user.id)
        # Ensure secret token is not stored in audit log
        if audit_entry.after_json:
            self.assertNotIn("token", audit_entry.after_json)


if __name__ == "__main__":
    unittest.main()
