import os
import sys
import uuid
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal, text
from app.models import User, Pump, DeviceAccess, Invite, RefreshToken, OtpChallenge, Organisation
from app.services.jwt_auth import hash_secret, sign_token
from app.core.authorization import (
    can_create_role, can, normalize_role,
    ROLE_SUPER_ADMIN, ROLE_PANEL_MANUFACTURER, ROLE_DISTRIBUTOR,
    ROLE_DEALER, ROLE_SUPPORT_ENGINEER, ROLE_END_USER, MAX_DEALER_DEPTH
)

client = TestClient(app)

class TestFunctionalAuthFlowSuite(unittest.TestCase):
    """
    Comprehensive functional authentication flow tests:
    - WhatsApp OTP request, rate limiting, and cooldown
    - OTP attempt limits and replay prevention
    - OTP expiration handling
    - Super Admin MFA requirement vs Non-Super Admin direct authentication
    - Role authorization & hierarchy enforcement (Dealer cannot create Distributor; 7th level dealer rejected)
    - Suspended account access denial
    - Tenant / Organisation scoping isolation
    - Rotating refresh tokens & logout
    """

    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))

        # 1. Super Admin User
        cls.sa_id = uuid.uuid4()
        cls.sa_phone = "+919999900001"
        cls.sa_user = User(
            id=cls.sa_id,
            phone=cls.sa_phone,
            phone_number=cls.sa_phone,
            full_name="Keerthi SuperAdmin",
            role=ROLE_SUPER_ADMIN,
            hierarchy_path="/SA",
            status="ACTIVE",
            account_status="ACTIVE",
            is_active=True,
            is_verified=True,
            mfa_enabled=True
        )

        # 2. Distributor User (Distributor A)
        cls.dist_a_id = uuid.uuid4()
        cls.dist_a_phone = "+919999900003"
        cls.dist_a_user = User(
            id=cls.dist_a_id,
            phone=cls.dist_a_phone,
            phone_number=cls.dist_a_phone,
            full_name="Distributor Alpha",
            role=ROLE_DISTRIBUTOR,
            hierarchy_path="/SA/DIST_A",
            status="ACTIVE",
            account_status="ACTIVE",
            is_active=True,
            is_verified=True
        )

        # 3. Distributor B User (Different Org Subtree)
        cls.dist_b_id = uuid.uuid4()
        cls.dist_b_phone = "+919999988888"
        cls.dist_b_user = User(
            id=cls.dist_b_id,
            phone=cls.dist_b_phone,
            phone_number=cls.dist_b_phone,
            full_name="Distributor Beta",
            role=ROLE_DISTRIBUTOR,
            hierarchy_path="/SA/DIST_B",
            status="ACTIVE",
            account_status="ACTIVE",
            is_active=True,
            is_verified=True
        )

        # 4. Dealer User under Distributor A
        cls.dealer_id = uuid.uuid4()
        cls.dealer_phone = "+919999900004"
        cls.dealer_user = User(
            id=cls.dealer_id,
            phone=cls.dealer_phone,
            phone_number=cls.dealer_phone,
            full_name="Kisan Dealer 1",
            role=ROLE_DEALER,
            hierarchy_path="/SA/DIST_A/DLR1",
            dealer_depth=1,
            status="ACTIVE",
            account_status="ACTIVE",
            is_active=True,
            is_verified=True
        )

        # 5. Suspended User
        cls.suspended_id = uuid.uuid4()
        cls.suspended_phone = "+919999900999"
        cls.suspended_user = User(
            id=cls.suspended_id,
            phone=cls.suspended_phone,
            phone_number=cls.suspended_phone,
            full_name="Suspended Account",
            role=ROLE_DEALER,
            hierarchy_path="/SA/DIST_A/SUSPENDED",
            status="SUSPENDED",
            account_status="SUSPENDED",
            is_active=False,
            is_verified=True
        )

        # 6. Pump owned by Distributor B
        cls.pump_b_id = f"PUMP-DIST-B-{uuid.uuid4().hex[:6]}"
        cls.pump_b = Pump(
            id=cls.pump_b_id,
            name="Distributor B Isolated Pump",
            supply_type="3-phase",
            owner_user_id=cls.dist_b_id,
            latitude=20.0,
            longitude=74.0,
            hierarchy_path="/SA/DIST_B",
            lifecycle_state="ACTIVE",
            status="STOPPED"
        )

        cls.db.add_all([
            cls.sa_user, cls.dist_a_user, cls.dist_b_user,
            cls.dealer_user, cls.suspended_user, cls.pump_b
        ])
        cls.db.commit()

    @classmethod
    def tearDownClass(cls):
        cls.db.execute(text("SET app.bypass_rls = 'on';"))
        cls.db.query(OtpChallenge).filter(OtpChallenge.phone_number.in_([
            cls.sa_phone, cls.dist_a_phone, cls.dist_b_phone,
            cls.dealer_phone, cls.suspended_phone, "+919876543210"
        ])).delete()
        cls.db.query(RefreshToken).filter(RefreshToken.user_id.in_([
            cls.sa_id, cls.dist_a_id, cls.dist_b_id, cls.dealer_id, cls.suspended_id
        ])).delete()
        cls.db.query(Pump).filter(Pump.id == cls.pump_b_id).delete()
        cls.db.query(User).filter(User.id.in_([
            cls.sa_id, cls.dist_a_id, cls.dist_b_id, cls.dealer_id, cls.suspended_id
        ])).delete()
        cls.db.commit()
        cls.db.close()

    def test_01_otp_request_and_rate_limit_cooldown(self):
        """Test requesting WhatsApp OTP and 30-second cooldown rate limit."""
        test_phone = "+919876543210"

        # First request should succeed
        res1 = client.post("/api/v1/auth/otp/request", json={"phone": test_phone})
        self.assertEqual(res1.status_code, 200, res1.text)
        data1 = res1.json()
        self.assertEqual(data1.get("status"), "OTP_REQUESTED")
        self.assertIn("dev_otp", data1)

        # Immediate second request should be rate-limited with HTTP 429
        res2 = client.post("/api/v1/auth/otp/request", json={"phone": test_phone})
        self.assertEqual(res2.status_code, 429, "Immediate OTP resend must be throttled with HTTP 429")

    def test_02_otp_attempt_limits_and_lockout(self):
        """Test that 5 consecutive incorrect OTPs trigger lockout (429)."""
        test_phone = "+919876543210"
        # Reset any existing challenge
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        self.db.query(OtpChallenge).filter(OtpChallenge.phone_number == test_phone).delete()
        self.db.commit()

        # Request OTP
        req_res = client.post("/api/v1/auth/otp/request", json={"phone": test_phone})
        self.assertEqual(req_res.status_code, 200)

        # Submit wrong OTP 4 times
        for attempt in range(4):
            res = client.post("/api/v1/auth/otp/verify", json={"phone": test_phone, "otp": "000000"})
            self.assertEqual(res.status_code, 400)
            self.assertIn("remaining", res.json().get("detail", ""))

        # 5th wrong attempt should result in HTTP 429 lockout
        res5 = client.post("/api/v1/auth/otp/verify", json={"phone": test_phone, "otp": "000000"})
        self.assertEqual(res5.status_code, 429)

    def test_03_otp_replay_prevention(self):
        """Test that a verified OTP is invalidated immediately and cannot be reused."""
        test_phone = self.dealer_phone
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        self.db.query(OtpChallenge).filter(OtpChallenge.phone_number == test_phone).delete()
        self.db.commit()

        # Request OTP
        req_res = client.post("/api/v1/auth/otp/request", json={"phone": test_phone})
        self.assertEqual(req_res.status_code, 200)
        otp_code = req_res.json().get("dev_otp")

        # First verification succeeds
        v1 = client.post("/api/v1/auth/otp/verify", json={"phone": test_phone, "otp": otp_code})
        self.assertEqual(v1.status_code, 200)
        self.assertEqual(v1.json().get("status"), "AUTHENTICATED")

        # Second verification with exact same OTP is rejected
        v2 = client.post("/api/v1/auth/otp/verify", json={"phone": test_phone, "otp": otp_code})
        self.assertEqual(v2.status_code, 400)
        self.assertIn("already been used", v2.json().get("detail", ""))

    def test_04_super_admin_requires_mfa_flow(self):
        """Test that Super Admin login requires Authenticator App MFA, while Dealer does not."""
        # 1. Super Admin OTP verification returns MFA_REQUIRED
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        self.db.query(OtpChallenge).filter(OtpChallenge.phone_number == self.sa_phone).delete()
        self.db.commit()

        req_sa = client.post("/api/v1/auth/otp/request", json={"phone": self.sa_phone})
        otp_sa = req_sa.json().get("dev_otp")

        res_sa = client.post("/api/v1/auth/otp/verify", json={"phone": self.sa_phone, "otp": otp_sa})
        self.assertEqual(res_sa.status_code, 200)
        data_sa = res_sa.json()
        self.assertEqual(data_sa.get("status"), "MFA_REQUIRED")
        self.assertTrue(data_sa.get("requires_mfa"))
        self.assertIn("challenge_id", data_sa)

        challenge_id = data_sa["challenge_id"]

        # Super Admin cannot access protected endpoints without completing MFA
        me_res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {data_sa.get('temp_token')}"})
        self.assertEqual(me_res.status_code, 401, "Temp MFA challenge token must not be accepted as an access token")

        # 2. Completing MFA verify yields authenticated session
        mfa_res = client.post("/api/v1/auth/mfa/verify", json={
            "challenge_id": challenge_id,
            "code": "123456"
        })
        self.assertEqual(mfa_res.status_code, 200, mfa_res.text)
        session_data = mfa_res.json()
        self.assertEqual(session_data.get("status"), "AUTHENTICATED")
        self.assertIn("access_token", session_data)

    def test_05_non_super_admin_mfa_bypass(self):
        """Test that non-Super Admin roles (Dealer, Distributor) authenticate immediately without MFA."""
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        self.db.query(OtpChallenge).filter(OtpChallenge.phone_number == self.dist_a_phone).delete()
        self.db.commit()

        req_dist = client.post("/api/v1/auth/otp/request", json={"phone": self.dist_a_phone})
        otp_dist = req_dist.json().get("dev_otp")

        res_dist = client.post("/api/v1/auth/otp/verify", json={"phone": self.dist_a_phone, "otp": otp_dist})
        self.assertEqual(res_dist.status_code, 200)
        data = res_dist.json()
        self.assertEqual(data.get("status"), "AUTHENTICATED")
        self.assertFalse(data.get("requires_mfa", False))
        self.assertIn("access_token", data)

    def test_06_suspended_account_rejected(self):
        """Test that a suspended user is rejected with HTTP 403 upon OTP verification."""
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        self.db.query(OtpChallenge).filter(OtpChallenge.phone_number == self.suspended_phone).delete()
        self.db.commit()

        req = client.post("/api/v1/auth/otp/request", json={"phone": self.suspended_phone})
        otp = req.json().get("dev_otp")

        verify_res = client.post("/api/v1/auth/otp/verify", json={"phone": self.suspended_phone, "otp": otp})
        self.assertEqual(verify_res.status_code, 403)
        self.assertIn("suspended", verify_res.json().get("detail", "").lower())

    def test_07_server_side_role_authorization_rules(self):
        """Test server-side hierarchy rules: Dealer cannot create Distributor, max dealer depth is 6."""
        # 1. can_create_role enforcement
        self.assertFalse(can_create_role(ROLE_DEALER, ROLE_DISTRIBUTOR), "Dealer must NOT be allowed to create Distributor")
        self.assertFalse(can_create_role(ROLE_DEALER, ROLE_PANEL_MANUFACTURER), "Dealer must NOT create Manufacturer")
        self.assertFalse(can_create_role(ROLE_DEALER, ROLE_SUPER_ADMIN), "Dealer must NOT create Super Admin")
        self.assertTrue(can_create_role(ROLE_DEALER, ROLE_END_USER), "Dealer can invite End User")
        self.assertTrue(can_create_role(ROLE_DISTRIBUTOR, ROLE_DEALER), "Distributor can create Dealer")
        self.assertTrue(can_create_role(ROLE_SUPER_ADMIN, ROLE_PANEL_MANUFACTURER), "Super Admin can create Manufacturer")

        # 2. Public registration cannot create SUPER_ADMIN or privileged partner roles
        reg_sa = client.post("/api/v1/auth/register/request", json={"phone": "+919111111111", "role": "superadmin"})
        self.assertEqual(reg_sa.status_code, 403, "Public registration for Super Admin must be forbidden")

        reg_dist = client.post("/api/v1/auth/register/request", json={"phone": "+919111111111", "role": "distributor"})
        self.assertEqual(reg_dist.status_code, 403, "Public registration for Distributor must require onboarding invite")

        # 3. Dealer depth <= 6 validation
        self.assertFalse(can({"role": ROLE_DEALER, "dealer_depth": 6}, "CREATE_DEALER"), "7th level dealer (depth 6 -> 7) must be rejected")
        self.assertTrue(can({"role": ROLE_DEALER, "dealer_depth": 5}, "CREATE_DEALER"), "6th level dealer must be permitted")

    def test_08_tenant_scoping_isolation(self):
        """Test that a distributor cannot access devices outside their permitted organisation/subtree."""
        # Create access token for Distributor A
        token_dist_a = sign_token({
            "sub": str(self.dist_a_id),
            "role": ROLE_DISTRIBUTOR,
            "hierarchy_path": "/SA/DIST_A",
            "session_ver": 1
        })

        # Distributor A attempts to fetch pump owned by Distributor B
        res = client.get(
            f"/api/v1/pumps/{self.pump_b_id}",
            headers={"Authorization": f"Bearer {token_dist_a}"}
        )
        # PostgreSQL RLS or repository scoping must deny access (403 or 404)
        self.assertIn(res.status_code, [403, 404], f"Cross-tenant access should be forbidden, got {res.status_code}")

    def test_09_rotating_refresh_tokens(self):
        """Test rotating refresh token with family reuse detection."""
        # Create session for Distributor A
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        self.db.query(OtpChallenge).filter(OtpChallenge.phone_number == self.dist_a_phone).delete()
        self.db.commit()

        req = client.post("/api/v1/auth/otp/request", json={"phone": self.dist_a_phone})
        otp = req.json().get("dev_otp")

        auth_res = client.post("/api/v1/auth/otp/verify", json={"phone": self.dist_a_phone, "otp": otp})
        self.assertEqual(auth_res.status_code, 200)
        initial_refresh = auth_res.json()["refresh_token"]

        # 1. Rotate refresh token
        ref1 = client.post("/api/v1/auth/refresh", json={"refresh_token": initial_refresh})
        self.assertEqual(ref1.status_code, 200)
        new_refresh = ref1.json()["refresh_token"]
        self.assertNotEqual(initial_refresh, new_refresh, "Refresh token must rotate upon use")

        # 2. Reuse of old refresh token must be detected and rejected
        ref2 = client.post("/api/v1/auth/refresh", json={"refresh_token": initial_refresh})
        self.assertEqual(ref2.status_code, 401, "Replaying a rotated refresh token must fail")

    def test_10_logout_and_session_invalidation(self):
        """Test that logout revokes the session and subsequent requests fail."""
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        self.db.query(OtpChallenge).filter(OtpChallenge.phone_number == self.dealer_phone).delete()
        self.db.commit()

        req = client.post("/api/v1/auth/otp/request", json={"phone": self.dealer_phone})
        otp = req.json().get("dev_otp")
        auth_res = client.post("/api/v1/auth/otp/verify", json={"phone": self.dealer_phone, "otp": otp})
        access_token = auth_res.json()["access_token"]
        refresh_token = auth_res.json()["refresh_token"]

        # Logout with refresh token
        logout_res = client.post(
            "/api/v1/auth/logout",
            headers={"Authorization": f"Bearer {access_token}"},
            json={"refresh_token": refresh_token}
        )
        self.assertEqual(logout_res.status_code, 200)

        # Refresh with revoked token should fail
        ref_res = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
        self.assertEqual(ref_res.status_code, 401)

if __name__ == "__main__":
    unittest.main()
