"""
Phase 2B: Backend RBAC + Organisation Scoping Test Suite
AgriPump SmartSpace Backend

Tests:
1. Super Admin global access.
2. Manufacturer subtree access and sibling isolation.
3. Distributor subtree access and sibling isolation.
4. Dealer subtree access and sibling isolation.
5. Insecure Direct Object Reference (IDOR) protection on /devices and /pumps.
6. End User (Farmer) device access and administrative prohibition.
7. Request tampering (org_id, role, device_id) rejection.
8. Centralized Permission system (RBAC matrix).
9. Mandatory tenant query predicate.
10. PostgreSQL Row-Level Security (RLS) enforcement as the second security boundary.
11. Audit logging without credential/secret leakage.
"""
import os
import sys
import unittest
import uuid
from datetime import datetime, timezone
import pyotp

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import text
from app.main import app
from app.database import SessionLocal
from app.models import (
    User, Organisation, Pump, DeviceAccess, AuditLog
)
from app.core.roles import (
    UserRole, OrgType, OrgStatus, UserStatus, to_db_role
)
from app.core.permissions import (
    Permission, role_has_permission, get_role_permissions
)
from app.services.authorization_service import (
    AuthorizationService, sanitize_audit_payload
)
from app.services.jwt_auth import hash_secret, sign_token
from app.api.deps import set_db_actor_context

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


class TestPhase2BRBACAndScoping(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))
        cls.sfx = uuid.uuid4().hex[:6]

        cls.user_ids = []
        cls.pump_ids = []
        cls.org_ids = []

        # 1. Root Organisation (SUPERADMIN)
        root_org = cls.db.query(Organisation).filter(Organisation.parent_id.is_(None)).first()
        if not root_org:
            root_org = Organisation(
                id=uuid.uuid4(),
                parent_id=None,
                type=OrgType.SUPERADMIN.value,
                name="AgriPump Root Platform",
                path="root",
                depth=0,
                status=OrgStatus.ACTIVE.value
            )
            cls.db.add(root_org)
            cls.db.commit()
            cls.org_ids.append(root_org.id)
        cls.root_org = root_org

        # 2. Super Admin User
        cls.sa_user = cls._create_user("superadmin", f"SA-{cls.sfx}", cls.root_org.id, "/SA")

        # 3. Manufacturer 1 & Manufacturer 2 (Siblings)
        cls.mfg_org_1 = cls._create_org("MANUFACTURER", f"Mfg 1 {cls.sfx}", cls.root_org)
        cls.mfg_user_1 = cls._create_user("manufacturer", f"MfgUser1-{cls.sfx}", cls.mfg_org_1.id, f"/SA/M1_{cls.sfx}")

        cls.mfg_org_2 = cls._create_org("MANUFACTURER", f"Mfg 2 {cls.sfx}", cls.root_org)
        cls.mfg_user_2 = cls._create_user("manufacturer", f"MfgUser2-{cls.sfx}", cls.mfg_org_2.id, f"/SA/M2_{cls.sfx}")

        # 4. Distributors under Mfg 1 (Siblings: Dist 1A and Dist 1B)
        cls.dist_org_1a = cls._create_org("DISTRIBUTOR", f"Dist 1A {cls.sfx}", cls.mfg_org_1)
        cls.dist_user_1a = cls._create_user("distributor", f"Dist1A-{cls.sfx}", cls.dist_org_1a.id, f"/SA/M1_{cls.sfx}/D1A")

        cls.dist_org_1b = cls._create_org("DISTRIBUTOR", f"Dist 1B {cls.sfx}", cls.mfg_org_1)
        cls.dist_user_1b = cls._create_user("distributor", f"Dist1B-{cls.sfx}", cls.dist_org_1b.id, f"/SA/M1_{cls.sfx}/D1B")

        # 5. Dealers under Dist 1A (Siblings: Dealer 1A_1 and Dealer 1A_2)
        cls.dealer_org_1a1 = cls._create_org("DEALER", f"Dealer 1A1 {cls.sfx}", cls.dist_org_1a)
        cls.dealer_user_1a1 = cls._create_user("dealer", f"Dealer1A1-{cls.sfx}", cls.dealer_org_1a1.id, f"/SA/M1_{cls.sfx}/D1A/DL1")

        cls.dealer_org_1a2 = cls._create_org("DEALER", f"Dealer 1A2 {cls.sfx}", cls.dist_org_1a)
        cls.dealer_user_1a2 = cls._create_user("dealer", f"Dealer1A2-{cls.sfx}", cls.dealer_org_1a2.id, f"/SA/M1_{cls.sfx}/D1A/DL2")

        # 6. Farmers (End Users)
        cls.farmer_1 = cls._create_user("customer", f"Farmer1-{cls.sfx}", cls.dealer_org_1a1.id, f"/SA/M1_{cls.sfx}/D1A/DL1/F1")
        cls.farmer_2 = cls._create_user("customer", f"Farmer2-{cls.sfx}", cls.dealer_org_1a2.id, f"/SA/M1_{cls.sfx}/D1A/DL2/F2")

        # 7. Pumps
        # Pump in Dealer 1A1 (owned by Farmer 1)
        cls.pump_dealer_1 = cls._create_pump(
            f"PUMP-DL1-{cls.sfx}", cls.dealer_org_1a1.id, cls.farmer_1.id, f"/SA/M1_{cls.sfx}/D1A/DL1/P1"
        )
        # Pump in Dealer 1A2 (owned by Farmer 2)
        cls.pump_dealer_2 = cls._create_pump(
            f"PUMP-DL2-{cls.sfx}", cls.dealer_org_1a2.id, cls.farmer_2.id, f"/SA/M1_{cls.sfx}/D1A/DL2/P2"
        )
        # Pump in Dist 1B
        cls.pump_dist_1b = cls._create_pump(
            f"PUMP-D1B-{cls.sfx}", cls.dist_org_1b.id, cls.dist_user_1b.id, f"/SA/M1_{cls.sfx}/D1B/P1"
        )
        # Pump in Mfg 2
        cls.pump_mfg_2 = cls._create_pump(
            f"PUMP-M2-{cls.sfx}", cls.mfg_org_2.id, cls.mfg_user_2.id, f"/SA/M2_{cls.sfx}/P1"
        )

    @classmethod
    def _create_org(cls, o_type: str, name: str, parent: Organisation) -> Organisation:
        oid = uuid.uuid4()
        label = str(oid).replace("-", "_")
        org = Organisation(
            id=oid,
            parent_id=parent.id,
            type=o_type,
            name=name,
            path=f"{parent.path}.{label}",
            depth=parent.depth + 1,
            status=OrgStatus.ACTIVE.value
        )
        cls.db.add(org)
        cls.db.commit()
        cls.org_ids.append(oid)
        return org

    @classmethod
    def _create_user(cls, role: str, tag: str, org_id: uuid.UUID, h_path: str) -> User:
        uid = uuid.uuid4()
        phone = f"+9198{abs(hash((tag, cls.sfx))) % 10**8:08d}"
        u = User(
            id=uid,
            full_name=f"User {tag}",
            phone=phone,
            phone_number=phone,
            role=role,
            org_id=org_id,
            hierarchy_path=h_path,
            account_status="ACTIVE",
            session_version=1,
            password_hash=hash_secret("SecPass!123"),
            totp_secret=pyotp.random_base32(),
            totp_enabled=True,
            is_active=True,
            is_verified=True
        )
        cls.db.add(u)
        cls.db.commit()
        cls.user_ids.append(uid)
        return u

    @classmethod
    def _create_pump(cls, pid: str, org_id: uuid.UUID, owner_id: uuid.UUID, h_path: str) -> Pump:
        p = Pump(
            id=pid,
            name=f"Pump {pid}",
            supply_type="3-phase",
            hp_rating=7.5,
            org_id=org_id,
            owner_user_id=owner_id,
            hierarchy_path=h_path,
            status="STOPPED",
            lifecycle_state="ACTIVE",
            last_seen_at=NOW
        )
        cls.db.add(p)
        cls.db.commit()
        cls.pump_ids.append(pid)
        return p

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            cls.db.query(Pump).filter(Pump.id.in_(cls.pump_ids)).delete(synchronize_session=False)
            cls.db.query(Organisation).filter(Organisation.id.in_(cls.org_ids)).delete(synchronize_session=False)
            cls.db.query(User).filter(User.id.in_(cls.user_ids)).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            cls.db.close()

    def setUp(self):
        self.db.rollback()
        self.db.execute(text("SET app.bypass_rls = 'on';"))

    # =========================================================================
    # 1. Super Admin Global Access
    # =========================================================================
    def test_01_super_admin_global_access(self):
        """Super Admin has global platform access to all devices and organisations."""
        headers = auth_header(self.sa_user)

        # Access all pumps regardless of subtree
        for pid in [self.pump_dealer_1.id, self.pump_dealer_2.id, self.pump_dist_1b.id, self.pump_mfg_2.id]:
            res = client.get(f"/api/v1/pumps/{pid}", headers=headers)
            self.assertEqual(res.status_code, 200, f"Super Admin should access pump {pid}: {res.text}")

        # Access via /devices alias
        res = client.get(f"/devices/{self.pump_dealer_1.id}", headers=headers)
        self.assertEqual(res.status_code, 200, "Super Admin should access pump via /devices alias")

    # =========================================================================
    # 2. Manufacturer Subtree Access and Sibling Isolation
    # =========================================================================
    def test_02_manufacturer_subtree_access_and_isolation(self):
        """Manufacturer 1 can access its subtree, but CANNOT access sibling Manufacturer 2."""
        headers_mfg1 = auth_header(self.mfg_user_1)

        # Mfg 1 CAN access downstream pumps under its distributors and dealers
        res1 = client.get(f"/api/v1/pumps/{self.pump_dealer_1.id}", headers=headers_mfg1)
        self.assertEqual(res1.status_code, 200, "Mfg 1 should access downstream Dealer 1A1 pump")

        res2 = client.get(f"/api/v1/pumps/{self.pump_dist_1b.id}", headers=headers_mfg1)
        self.assertEqual(res2.status_code, 200, "Mfg 1 should access downstream Dist 1B pump")

        # Mfg 1 CANNOT access sibling Mfg 2 pump (returns 404 Not Found to prevent tenant leakage)
        res_sibling = client.get(f"/api/v1/pumps/{self.pump_mfg_2.id}", headers=headers_mfg1)
        self.assertEqual(res_sibling.status_code, 404, "Mfg 1 must NOT access sibling Mfg 2 pump")

        # Mfg 1 CANNOT access sibling Mfg 2 organisation
        res_org = client.get(f"/organisations/{self.mfg_org_2.id}", headers=headers_mfg1)
        self.assertEqual(res_org.status_code, 404, "Mfg 1 must NOT access sibling Mfg 2 organisation")

    # =========================================================================
    # 3. Distributor Subtree Access and Sibling Isolation
    # =========================================================================
    def test_03_distributor_subtree_access_and_isolation(self):
        """Distributor 1A can access its dealers, but CANNOT access sibling Distributor 1B."""
        headers_dist1a = auth_header(self.dist_user_1a)

        # Dist 1A CAN access Dealer 1A1 pump
        res1 = client.get(f"/api/v1/pumps/{self.pump_dealer_1.id}", headers=headers_dist1a)
        self.assertEqual(res1.status_code, 200, "Dist 1A should access downstream Dealer 1A1 pump")

        # Dist 1A CANNOT access sibling Dist 1B pump
        res_sibling = client.get(f"/api/v1/pumps/{self.pump_dist_1b.id}", headers=headers_dist1a)
        self.assertEqual(res_sibling.status_code, 404, "Dist 1A must NOT access sibling Dist 1B pump")

        # Dist 1A CANNOT access sibling Dist 1B organisation
        res_org = client.get(f"/organisations/{self.dist_org_1b.id}", headers=headers_dist1a)
        self.assertEqual(res_org.status_code, 404, "Dist 1A must NOT access sibling Dist 1B organisation")

    # =========================================================================
    # 4. Dealer Subtree Access and Sibling Isolation
    # =========================================================================
    def test_04_dealer_subtree_access_and_isolation(self):
        """Dealer 1A1 can access its own pump, but CANNOT access sibling Dealer 1A2."""
        headers_dl1 = auth_header(self.dealer_user_1a1)

        # Dealer 1A1 CAN access its own pump
        res1 = client.get(f"/api/v1/pumps/{self.pump_dealer_1.id}", headers=headers_dl1)
        self.assertEqual(res1.status_code, 200, "Dealer 1A1 should access its own pump")

        # Dealer 1A1 CANNOT access sibling Dealer 1A2 pump
        res2 = client.get(f"/api/v1/pumps/{self.pump_dealer_2.id}", headers=headers_dl1)
        self.assertEqual(res2.status_code, 404, "Dealer 1A1 must NOT access sibling Dealer 1A2 pump")

        # Dealer 1A1 CANNOT access sibling Dealer 1A2 organisation
        res_org = client.get(f"/organisations/{self.dealer_org_1a2.id}", headers=headers_dl1)
        self.assertEqual(res_org.status_code, 404, "Dealer 1A1 must NOT access sibling Dealer 1A2 organisation")

    # =========================================================================
    # 5. IDOR Protection (Insecure Direct Object Reference)
    # =========================================================================
    def test_05_idor_protection_device_endpoints(self):
        """Dealer calling /devices/DEVICE_BELONGING_TO_DEALER_B returns 404 without leaking existence."""
        headers_dl1 = auth_header(self.dealer_user_1a1)

        # GET /devices/{id}
        res_dev = client.get(f"/devices/{self.pump_dealer_2.id}", headers=headers_dl1)
        self.assertEqual(res_dev.status_code, 404, "IDOR on /devices/{id} must return 404")

        # GET /api/v1/pumps/{id}
        res_pump = client.get(f"/api/v1/pumps/{self.pump_dealer_2.id}", headers=headers_dl1)
        self.assertEqual(res_pump.status_code, 404, "IDOR on /pumps/{id} must return 404")

        # POST /devices/{id}/commands
        cmd_payload = {"action_name": "START", "payload": {}}
        res_cmd = client.post(f"/devices/{self.pump_dealer_2.id}/commands", json=cmd_payload, headers=headers_dl1)
        self.assertEqual(res_cmd.status_code, 404, "Attempting to control out-of-scope device must return 404")

    # =========================================================================
    # 6. End User (Farmer) Isolation and Admin Restriction
    # =========================================================================
    def test_06_farmer_end_user_isolation(self):
        """Farmer 1 can view own device, cannot access Farmer 2 device, and cannot perform admin operations."""
        headers_f1 = auth_header(self.farmer_1)

        # Farmer 1 CAN view their own pump
        res_own = client.get(f"/api/v1/pumps/{self.pump_dealer_1.id}", headers=headers_f1)
        self.assertEqual(res_own.status_code, 200, "Farmer 1 should view their own pump")

        # Farmer 1 CANNOT view Farmer 2 pump
        res_other = client.get(f"/api/v1/pumps/{self.pump_dealer_2.id}", headers=headers_f1)
        self.assertEqual(res_other.status_code, 404, "Farmer 1 must NOT view Farmer 2 pump")

        # Farmer 1 CANNOT create organisations (403 Forbidden)
        org_payload = {"name": "Illegal Org", "type": "DEALER"}
        res_org = client.post("/organisations", json=org_payload, headers=headers_f1)
        self.assertEqual(res_org.status_code, 403, "Farmer must not be allowed to create organisations")

        # Farmer 1 CANNOT create users (403 Forbidden)
        user_payload = {"phone": "+919777777777", "full_name": "Hacker", "role": "DEALER"}
        res_usr = client.post(f"/organisations/{self.dealer_org_1a1.id}/users", json=user_payload, headers=headers_f1)
        self.assertEqual(res_usr.status_code, 403, "Farmer must not be allowed to create users")

    # =========================================================================
    # 7. Request Tampering Does NOT Bypass Authorization
    # =========================================================================
    def test_07_request_tampering_fails_to_bypass_authorization(self):
        """Manipulating org_id, role, or device_id in request payload is blocked."""
        headers_dl1 = auth_header(self.dealer_user_1a1)

        # 1. Dealer 1A1 tries to create user under sibling Dealer 1A2's organisation
        user_payload = {
            "phone": f"+9196{abs(hash(('hack', self.sfx))) % 10**8:08d}",
            "full_name": "Tampered User",
            "role": "DEALER"
        }
        res_tamper_org = client.post(f"/organisations/{self.dealer_org_1a2.id}/users", json=user_payload, headers=headers_dl1)
        self.assertIn(res_tamper_org.status_code, (403, 404), "Creating user under out-of-scope org must be rejected")

        # 2. Dealer 1A1 attempts to change Farmer 1's organisation to Distributor
        patch_payload = {"org_id": str(self.dist_org_1a.id)}
        res_patch_org = client.patch(f"/users/{self.farmer_1.id}", json=patch_payload, headers=headers_dl1)
        self.assertEqual(res_patch_org.status_code, 403, "Dealer cannot move a user to an unauthorized organisation")

    # =========================================================================
    # 8. Centralized Permission System (RBAC Matrix)
    # =========================================================================
    def test_08_rbac_permission_matrix(self):
        """Verifies role permissions match the centralized RBAC rules."""
        # Super Admin has all permissions
        sa_perms = get_role_permissions(UserRole.SUPER_ADMIN)
        self.assertIn(Permission.VIEW_GLOBAL_DASHBOARD, sa_perms)
        self.assertIn(Permission.MANAGE_FIRMWARE, sa_perms)
        self.assertIn(Permission.CREATE_OTA_JOB, sa_perms)
        self.assertIn(Permission.VIEW_AUDIT_LOG, sa_perms)
        self.assertIn(Permission.VIEW_SYSTEM_HEALTH, sa_perms)

        # Dealer lacks firmware and global dashboard permissions
        dl_perms = get_role_permissions(UserRole.DEALER)
        self.assertNotIn(Permission.VIEW_GLOBAL_DASHBOARD, dl_perms)
        self.assertNotIn(Permission.MANAGE_FIRMWARE, dl_perms)
        self.assertNotIn(Permission.CREATE_OTA_JOB, dl_perms)
        self.assertNotIn(Permission.CREATE_MANUFACTURER, dl_perms)
        self.assertNotIn(Permission.CREATE_DISTRIBUTOR, dl_perms)

        # End user has strictly device view/control and alert permissions
        eu_perms = get_role_permissions(UserRole.END_USER)
        self.assertEqual(eu_perms, {Permission.VIEW_DEVICE, Permission.CONTROL_DEVICE, Permission.VIEW_ALERTS})

        # Dealer attempting to access audit log API returns 403
        headers_dl1 = auth_header(self.dealer_user_1a1)
        res_audit = client.get("/api/v1/audit-log", headers=headers_dl1)
        self.assertEqual(res_audit.status_code, 403, "Dealer should be denied access to audit log")

    # =========================================================================
    # 9. Mandatory Tenant Predicate Application
    # =========================================================================
    def test_09_mandatory_tenant_predicate_query(self):
        """apply_tenant_scope restricts database queries to caller's permitted subtree."""
        # Querying Pump with dealer_user_1a1
        scoped_pumps_query = AuthorizationService.apply_tenant_scope(
            self.db.query(Pump), Pump, self.dealer_user_1a1, self.db
        )
        pumps = scoped_pumps_query.all()
        pump_ids = [p.id for p in pumps]

        self.assertIn(self.pump_dealer_1.id, pump_ids, "Dealer 1A1 pump must be in query results")
        self.assertNotIn(self.pump_dealer_2.id, pump_ids, "Dealer 1A2 pump must NOT be in query results")
        self.assertNotIn(self.pump_dist_1b.id, pump_ids, "Dist 1B pump must NOT be in query results")
        self.assertNotIn(self.pump_mfg_2.id, pump_ids, "Mfg 2 pump must NOT be in query results")

    # =========================================================================
    # 10. PostgreSQL Row-Level Security (RLS) as Second Security Boundary
    # =========================================================================
    def test_10_postgresql_rls_second_security_boundary(self):
        """Row-level security in PostgreSQL filters rows directly even on raw unfiltered queries."""
        rls_session = SessionLocal()
        try:
            # Set RLS context for Dealer 1A1 without setting bypass_rls
            set_db_actor_context(rls_session, user=self.dealer_user_1a1)

            # Raw query without WHERE clause — RLS policy must filter out sibling rows!
            rows = rls_session.query(Pump.id).all()
            seen_ids = [r[0] for r in rows]

            self.assertIn(self.pump_dealer_1.id, seen_ids, "Dealer 1A1 pump must be visible in RLS")
            self.assertNotIn(self.pump_dealer_2.id, seen_ids, "Dealer 1A2 pump must be filtered by PostgreSQL RLS")
            self.assertNotIn(self.pump_mfg_2.id, seen_ids, "Mfg 2 pump must be filtered by PostgreSQL RLS")
        finally:
            rls_session.close()

    # =========================================================================
    # 11. Audit Logging and Credential Redaction
    # =========================================================================
    def test_11_audit_logging_and_credential_redaction(self):
        """Privileged actions write audit logs and redact secret fields."""
        payload = {
            "full_name": "Test User",
            "password": "SuperSecretPassword123",
            "token": "secret_jwt_token",
            "totp_secret": "JBSWY3DPEHPK3PXP",
            "phone": "+919876543210"
        }
        sanitized = sanitize_audit_payload(payload)
        self.assertEqual(sanitized["password"], "[REDACTED]")
        self.assertEqual(sanitized["token"], "[REDACTED]")
        self.assertEqual(sanitized["totp_secret"], "[REDACTED]")
        self.assertEqual(sanitized["phone"], "+919876543210")

        # Test log_audit persists to database
        entry = AuthorizationService.log_audit(
            db=self.db,
            actor=self.sa_user,
            action="TEST_PRIVILEGED_ACTION",
            entity_type="device",
            entity_id=self.pump_dealer_1.id,
            before=payload,
            after={"status": "UPDATED"},
            ip="127.0.0.1"
        )
        self.assertIsNotNone(entry.id)
        self.assertEqual(entry.before_json["password"], "[REDACTED]")
        self.assertEqual(entry.before_json["token"], "[REDACTED]")


if __name__ == "__main__":
    unittest.main()
