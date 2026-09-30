import os
import sys
import uuid
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal, text
from app.models import User, Pump, DeviceAccess, Invite, RefreshToken
from app.services.jwt_auth import hash_secret

client = TestClient(app)

class TestAuthHardeningSuite(unittest.TestCase):
    """
    Test suite for P1.6 Authentication Hardening (FR-APP-002, FR-CLD-041, FR-SEC-023/024/025).
    """

    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))

        # Create dealer user
        cls.dealer_id = uuid.uuid4()
        cls.dealer = User(
            id=cls.dealer_id,
            phone="+919333333333",
            full_name="Hardened Dealer",
            role="dealer",
            hierarchy_path="/SA/DLR_HARDENED",
            password_hash=hash_secret("Password123!"),
            is_active=True,
            is_verified=True
        )

        # Create farmer user
        cls.farmer_id = uuid.uuid4()
        cls.farmer_phone = "+919444444444"
        cls.farmer = User(
            id=cls.farmer_id,
            phone=cls.farmer_phone,
            full_name="Hardened Farmer",
            role="customer",
            hierarchy_path="/SA/DLR_HARDENED/FMR",
            password_hash=hash_secret("Password123!"),
            is_active=True,
            is_verified=True
        )

        # Create test pump
        cls.pump_id = f"PUMP-AUTH-{uuid.uuid4().hex[:6]}"
        cls.pump = Pump(
            id=cls.pump_id,
            name="Auth Test Pump",
            supply_type="3-phase",
            owner_user_id=cls.dealer_id,
            latitude=19.0,
            longitude=73.0,
            hierarchy_path="/SA/DLR_HARDENED",
            lifecycle_state="ACTIVE",
            status="STOPPED"
        )

        cls.db.add_all([cls.dealer, cls.farmer, cls.pump])
        cls.db.commit()

    @classmethod
    def tearDownClass(cls):
        cls.db.execute(text("SET app.bypass_rls = 'on';"))
        cls.db.query(DeviceAccess).filter(DeviceAccess.user_id.in_([cls.dealer_id, cls.farmer_id])).delete()
        cls.db.query(Invite).filter(Invite.invited_by == cls.dealer_id).delete()
        cls.db.query(RefreshToken).filter(RefreshToken.user_id.in_([cls.dealer_id, cls.farmer_id])).delete()
        cls.db.query(Pump).filter(Pump.id == cls.pump_id).delete()
        cls.db.query(User).filter(User.id.in_([cls.dealer_id, cls.farmer_id])).delete()
        cls.db.commit()
        cls.db.close()

    def test_01_token_family_rotation_and_reuse_detection(self):
        """
        FR-SEC-024: Rotating refresh tokens with reuse detection.
        Replaying a previously used refresh token MUST revoke the entire family.
        """
        # 1. Login with password
        r = client.post("/api/v1/auth/login-password", json={
            "phone_number": "+919333333333",
            "password": "Password123!",
            "app_install_id": "install-device-1",
            "device_info": "iPhone 15 Pro"
        })
        self.assertEqual(r.status_code, 200, f"Login failed: {r.text}")
        data = r.json()
        token_1 = data["refresh_token"]
        access_1 = data["access_token"]
        self.assertIsNotNone(token_1)

        # 2. Legitimate refresh: rotate token_1 -> token_2
        r_ref = client.post("/api/v1/auth/refresh", json={
            "refresh_token": token_1,
            "app_install_id": "install-device-1"
        })
        self.assertEqual(r_ref.status_code, 200, f"Refresh failed: {r_ref.text}")
        token_2 = r_ref.json()["refresh_token"]
        self.assertNotEqual(token_1, token_2, "Refresh token must rotate!")

        # 3. Attacker replays token_1 (REUSE DETECTION)
        r_replay = client.post("/api/v1/auth/refresh", json={
            "refresh_token": token_1,
            "app_install_id": "install-device-1"
        })
        self.assertEqual(r_replay.status_code, 401)
        self.assertIn("Compromised refresh token reused", r_replay.json()["detail"])
        print("\n[PASS] 1a. Replayed refresh token was blocked and flagged as compromised!")

        # 4. Assert that token_2 in the same family has now been REVOKED due to reuse!
        r_after = client.post("/api/v1/auth/refresh", json={
            "refresh_token": token_2,
            "app_install_id": "install-device-1"
        })
        self.assertEqual(r_after.status_code, 401)
        print("[PASS] 1b. Entire token family was automatically revoked upon reuse detection!")

    def test_02_device_binding_enforcement(self):
        """FR-SEC-025: Refresh token bound to app_install_id cannot be used from different device."""
        r = client.post("/api/v1/auth/login-password", json={
            "phone_number": "+919333333333",
            "password": "Password123!",
            "app_install_id": "bound-device-alpha"
        })
        token = r.json()["refresh_token"]

        # Attempt to refresh using a different install id
        r_diff = client.post("/api/v1/auth/refresh", json={
            "refresh_token": token,
            "app_install_id": "stolen-device-beta"
        })
        self.assertEqual(r_diff.status_code, 401)
        self.assertIn("bound to different device installation", r_diff.json()["detail"])
        print("[PASS] 2. Device binding enforced: rejected refresh from different app_install_id!")

    def test_03_fast_session_revocation_on_logout(self):
        """
        FR-CLD-041: Revocation <= 60s.
        Logout increments session_version; old access token must immediately fail.
        """
        r_login = client.post("/api/v1/auth/login-password", json={
            "phone_number": "+919333333333",
            "password": "Password123!"
        })
        access_tok = r_login.json()["access_token"]
        auth_hdr = {"Authorization": f"Bearer {access_tok}"}

        # Token works initially
        r_me = client.get("/api/v1/auth/me", headers=auth_hdr)
        self.assertEqual(r_me.status_code, 200)

        # User logs out
        r_out = client.post("/api/v1/auth/logout", headers=auth_hdr)
        self.assertEqual(r_out.status_code, 200)

        # Subsequent call with previous access token MUST be rejected immediately (<= 60s target)
        r_me_revoked = client.get("/api/v1/auth/me", headers=auth_hdr)
        self.assertEqual(r_me_revoked.status_code, 401)
        self.assertIn("Session has been revoked", r_me_revoked.json()["detail"])
        print("[PASS] 3. Session revocation confirmed: access token invalidated immediately on logout!")

    def test_04_session_listing_and_revocation(self):
        """Test /me/sessions listing and individual family revocation."""
        r_login = client.post("/api/v1/auth/login-password", json={
            "phone_number": "+919333333333",
            "password": "Password123!",
            "device_info": "Samsung S24 Ultra"
        })
        access_tok = r_login.json()["access_token"]
        auth_hdr = {"Authorization": f"Bearer {access_tok}"}

        # List sessions
        r_sess = client.get("/api/v1/auth/me/sessions", headers=auth_hdr)
        self.assertEqual(r_sess.status_code, 200)
        sessions = r_sess.json().get("sessions", [])
        self.assertGreater(len(sessions), 0)
        target_family = sessions[0]["family_id"]

        # Revoke session
        r_del = client.delete(f"/api/v1/auth/me/sessions/{target_family}", headers=auth_hdr)
        self.assertEqual(r_del.status_code, 200)
        print("[PASS] 4. Listed and revoked specific session family successfully!")

    def test_05_invite_flow_and_auto_redemption(self):
        """
        Dealer creates invite; farmer OTP login automatically consumes invite and grants device_access.
        """
        # 1. Dealer logs in
        r_dealer = client.post("/api/v1/auth/login-password", json={
            "phone_number": "+919333333333",
            "password": "Password123!"
        })
        dealer_hdr = {"Authorization": f"Bearer {r_dealer.json()['access_token']}"}

        # 2. Dealer issues invite for farmer phone + test pump
        r_inv = client.post("/api/v1/auth/invites", headers=dealer_hdr, json={
            "phone": self.farmer_phone,
            "device_id": self.pump_id,
            "role": "owner"
        })
        self.assertEqual(r_inv.status_code, 200, f"Create invite failed: {r_inv.text}")
        print(f"[PASS] 5a. Dealer issued invite: {r_inv.json()['token'][:12]}...")

        # 3. Farmer requests and verifies OTP
        r_send = client.post("/api/v1/auth/send-otp", json={"phone_number": self.farmer_phone})
        otp = r_send.json().get("dev_otp")

        r_verify = client.post("/api/v1/auth/verify-otp", json={
            "phone_number": self.farmer_phone,
            "otp_code": otp
        })
        self.assertEqual(r_verify.status_code, 200, f"Farmer verify-otp failed: {r_verify.text}")
        farmer_hdr = {"Authorization": f"Bearer {r_verify.json()['access_token']}"}

        # 4. Assert that DeviceAccess was granted and pump is now visible to farmer!
        r_pumps = client.get("/api/v1/pumps", headers=farmer_hdr)
        self.assertEqual(r_pumps.status_code, 200)
        pumps = r_pumps.json().get("data", [])
        pump_ids = [p["id"] for p in pumps]
        self.assertIn(self.pump_id, pump_ids, "Farmer should now have device access to invited pump!")
        print(f"[PASS] 5b. Farmer successfully redeemed invite upon OTP verification and has pump in scope!")

if __name__ == "__main__":
    unittest.main()
