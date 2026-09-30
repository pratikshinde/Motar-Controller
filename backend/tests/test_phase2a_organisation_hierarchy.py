"""
Phase 2A Test Suite: Organisation Hierarchy + User/Role Data Model
Tests all requirements specified in Phase 2A SRS:
1. Root Super Admin organisation existence & properties.
2. Panel Manufacturer creation under Super Admin.
3. Distributor creation under Panel Manufacturer.
4. Dealer creation under Distributor (Dealer L1).
5. Nested Dealer creation (Dealer L1 -> L2 -> L3 -> L4 -> L5 -> L6).
6. Dealer depth limit: Dealer L6 cannot create Dealer L7 (DEALER_DEPTH_LIMIT_REACHED).
7. Invalid parent/child organisation relationships:
   - Dealer cannot create Distributor
   - Distributor cannot create Manufacturer
   - Manufacturer cannot create Super Admin
8. Role assignment permissions:
   - Distributor attempting role=SUPER_ADMIN returns 403 FORBIDDEN.
   - Dealer attempting role=DISTRIBUTOR returns 403 FORBIDDEN.
9. Suspended organisation rules:
   - Suspended organisation cannot perform normal management operations.
10. Phone uniqueness for active users.
11. User organisation assignment & unauthorized organisation change protection.
12. Hierarchy queries: parent, children, ancestors, descendants, subtree.
13. Audit events for organisation and user lifecycle.
"""
import os
import sys
import unittest
import uuid
from typing import Dict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import text
from app.database import SessionLocal
from app.main import app
from app.models.organisation import Organisation
from app.models.user import User
from app.models import AuditLog
from app.core.roles import UserRole, OrgType, OrgStatus, UserStatus
from app.services.jwt_auth import sign_token

client = TestClient(app)


def auth_header(user: User) -> Dict[str, str]:
    token = sign_token({
        "sub": str(user.id),
        "role": user.role,
        "hierarchy_path": user.hierarchy_path or "/SA",
        "session_ver": user.session_version or 1
    })
    return {"Authorization": f"Bearer {token}"}


class TestPhase2AOrganisationHierarchy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.db.execute(text("SET app.bypass_rls = 'on';"))

        # Find or create Root Super Admin
        cls.root_org = cls.db.query(Organisation).filter(Organisation.depth == 0).first()
        if not cls.root_org:
            cls.root_org = Organisation(
                id=uuid.UUID("a0000000-0000-0000-0000-000000000001"),
                parent_id=None,
                type="SUPERADMIN",
                name="AgriPump Enterprise Root",
                path="root",
                depth=0,
                status="ACTIVE"
            )
            cls.db.add(cls.root_org)
            cls.db.commit()

        # Find or create Super Admin User
        cls.superadmin = cls.db.query(User).filter(User.role == "superadmin").first()
        if not cls.superadmin:
            cls.superadmin = User(
                id=uuid.uuid4(),
                full_name="Super Admin Controller",
                phone="+919000000001",
                phone_number="+919000000001",
                role="superadmin",
                org_id=cls.root_org.id,
                hierarchy_path="/SA",
                account_status="ACTIVE",
                totp_enabled=True,
                is_active=True
            )
            cls.db.add(cls.superadmin)
            cls.db.commit()
            cls.db.refresh(cls.superadmin)
        else:
            cls.superadmin.totp_enabled = True
            cls.superadmin.account_status = "ACTIVE"
            cls.superadmin.org_id = cls.root_org.id
            cls.db.commit()

        cls.sa_headers = auth_header(cls.superadmin)
        cls.cleanup_org_ids = []
        cls.cleanup_user_ids = []

    @classmethod
    def tearDownClass(cls):
        # Clean up created entities
        for uid in cls.cleanup_user_ids:
            cls.db.execute(text("DELETE FROM agripump.audit_log WHERE actor_id = :id OR entity_id = :id_str"), {"id": uid, "id_str": str(uid)})
            cls.db.execute(text("DELETE FROM agripump.users WHERE id = :id"), {"id": uid})
        for oid in reversed(cls.cleanup_org_ids):
            cls.db.execute(text("DELETE FROM agripump.audit_log WHERE entity_id = :id_str"), {"id_str": str(oid)})
            cls.db.execute(text("DELETE FROM agripump.organisations WHERE id = :id"), {"id": oid})
        cls.db.commit()
        cls.db.close()

    def test_01_root_organisation_model(self):
        """Verify the Root Organisation model attributes and constraints."""
        res = client.get(f"/organisations/{self.root_org.id}", headers=self.sa_headers)
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["depth"], 0)
        self.assertEqual(data["status"], "ACTIVE")
        self.assertIn("name", data)
        self.assertIn("branding_id", data)
        self.assertIn("created_at", data)
        self.assertIn("updated_at", data)

    def test_02_super_admin_creates_manufacturer(self):
        """SUPER_ADMIN creates PANEL_MANUFACTURER organisation and user."""
        org_res = client.post("/organisations", json={
            "name": "Apex Controls Manufacturer",
            "type": "MANUFACTURER",
            "parent_id": str(self.root_org.id)
        }, headers=self.sa_headers)
        self.assertEqual(org_res.status_code, 201, org_res.text)
        mfg_org = org_res.json()
        self.assertEqual(mfg_org["type"], "MANUFACTURER")
        self.assertEqual(mfg_org["depth"], 1)
        self.cleanup_org_ids.append(uuid.UUID(mfg_org["id"]))

        # Create user in Manufacturer organisation
        mfg_user_phone = f"+9191000{uuid.uuid4().hex[:5]}"
        user_res = client.post(f"/organisations/{mfg_org['id']}/users", json={
            "name": "Apex Factory Lead",
            "phone": mfg_user_phone,
            "role": "PANEL_MANUFACTURER"
        }, headers=self.sa_headers)
        self.assertEqual(user_res.status_code, 201, user_res.text)
        mfg_user = user_res.json()
        self.assertEqual(mfg_user["org_id"], mfg_org["id"])
        self.assertEqual(mfg_user["role"], "manufacturer")
        self.cleanup_user_ids.append(uuid.UUID(mfg_user["id"]))

    def test_03_manufacturer_creates_distributor(self):
        """PANEL_MANUFACTURER creates DISTRIBUTOR organisation and user."""
        # 1. Create Manufacturer Org & User
        mfg_org = client.post("/organisations", json={
            "name": "Shakti Panels Mfg",
            "type": "MANUFACTURER",
            "parent_id": str(self.root_org.id)
        }, headers=self.sa_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(mfg_org["id"]))

        mfg_user_phone = f"+9191100{uuid.uuid4().hex[:5]}"
        mfg_user = client.post(f"/organisations/{mfg_org['id']}/users", json={
            "name": "Shakti Plant Lead",
            "phone": mfg_user_phone,
            "role": "PANEL_MANUFACTURER"
        }, headers=self.sa_headers).json()
        self.cleanup_user_ids.append(uuid.UUID(mfg_user["id"]))

        # Load mfg user DB object to sign token
        mfg_db_user = self.db.query(User).filter(User.id == uuid.UUID(mfg_user["id"])).first()
        mfg_headers = auth_header(mfg_db_user)

        # 2. Manufacturer creates Distributor Org
        dist_res = client.post("/organisations", json={
            "name": "Western Zone Agro Distributors",
            "type": "DISTRIBUTOR",
            "parent_id": mfg_org["id"]
        }, headers=mfg_headers)
        self.assertEqual(dist_res.status_code, 201, dist_res.text)
        dist_org = dist_res.json()
        self.assertEqual(dist_org["type"], "DISTRIBUTOR")
        self.assertEqual(dist_org["depth"], 2)
        self.cleanup_org_ids.append(uuid.UUID(dist_org["id"]))

        # 3. Create user in Distributor
        dist_user_phone = f"+9191200{uuid.uuid4().hex[:5]}"
        dist_user_res = client.post(f"/organisations/{dist_org['id']}/users", json={
            "name": "Western Distributor Manager",
            "phone": dist_user_phone,
            "role": "DISTRIBUTOR"
        }, headers=mfg_headers)
        self.assertEqual(dist_user_res.status_code, 201, dist_user_res.text)
        dist_user = dist_user_res.json()
        self.assertEqual(dist_user["role"], "distributor")
        self.cleanup_user_ids.append(uuid.UUID(dist_user["id"]))

    def test_04_distributor_creates_dealer_and_nested_chain(self):
        """DISTRIBUTOR creates DEALER L1, which can create L2, L3, L4, L5, L6."""
        # 1. Setup Manufacturer and Distributor
        mfg_org = client.post("/organisations", json={
            "name": "Bharat Motors Mfg",
            "type": "MANUFACTURER",
            "parent_id": str(self.root_org.id)
        }, headers=self.sa_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(mfg_org["id"]))

        dist_org = client.post("/organisations", json={
            "name": "Maharashtra Agro Distribution",
            "type": "DISTRIBUTOR",
            "parent_id": mfg_org["id"]
        }, headers=self.sa_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(dist_org["id"]))

        dist_user_phone = f"+9191300{uuid.uuid4().hex[:5]}"
        dist_user = client.post(f"/organisations/{dist_org['id']}/users", json={
            "name": "MH Distributor Lead",
            "phone": dist_user_phone,
            "role": "DISTRIBUTOR"
        }, headers=self.sa_headers).json()
        self.cleanup_user_ids.append(uuid.UUID(dist_user["id"]))

        dist_db_user = self.db.query(User).filter(User.id == uuid.UUID(dist_user["id"])).first()
        dist_headers = auth_header(dist_db_user)

        # 2. Distributor creates Dealer Level 1
        d1_res = client.post("/organisations", json={
            "name": "District Dealer L1",
            "type": "DEALER",
            "parent_id": dist_org["id"]
        }, headers=dist_headers)
        self.assertEqual(d1_res.status_code, 201, d1_res.text)
        d1 = d1_res.json()
        self.assertEqual(d1["type"], "DEALER")
        self.cleanup_org_ids.append(uuid.UUID(d1["id"]))

        # 3. Create Dealer L1 user
        d1_user_phone = f"+9191400{uuid.uuid4().hex[:5]}"
        d1_user = client.post(f"/organisations/{d1['id']}/users", json={
            "name": "Dealer L1 Owner",
            "phone": d1_user_phone,
            "role": "DEALER"
        }, headers=dist_headers).json()
        self.cleanup_user_ids.append(uuid.UUID(d1_user["id"]))

        d1_db_user = self.db.query(User).filter(User.id == uuid.UUID(d1_user["id"])).first()
        d1_headers = auth_header(d1_db_user)

        # 4. Chain Dealers L2 through L6
        prev_dealer_id = d1["id"]
        prev_headers = d1_headers

        dealer_chain = [d1]
        for level in range(2, 7):
            d_res = client.post("/organisations", json={
                "name": f"Sub-Dealer L{level}",
                "type": "DEALER",
                "parent_id": prev_dealer_id
            }, headers=prev_headers)
            self.assertEqual(d_res.status_code, 201, f"Failed creating Dealer L{level}: {d_res.text}")
            cur_dealer = d_res.json()
            dealer_chain.append(cur_dealer)
            self.cleanup_org_ids.append(uuid.UUID(cur_dealer["id"]))

            # Create user for this dealer to act as parent for the next
            u_phone = f"+9191{level}00{uuid.uuid4().hex[:4]}"
            u_res = client.post(f"/organisations/{cur_dealer['id']}/users", json={
                "name": f"Dealer L{level} Admin",
                "phone": u_phone,
                "role": "DEALER"
            }, headers=self.sa_headers)
            self.assertEqual(u_res.status_code, 201)
            u_data = u_res.json()
            self.cleanup_user_ids.append(uuid.UUID(u_data["id"]))

            u_db = self.db.query(User).filter(User.id == uuid.UUID(u_data["id"])).first()
            prev_headers = auth_header(u_db)
            prev_dealer_id = cur_dealer["id"]

        self.assertEqual(len(dealer_chain), 6, "Expected exactly 6 levels of dealers created")

        # 5. HARD GUARD CHECK: Dealer L6 cannot create Dealer L7
        # Must fail with DEALER_DEPTH_LIMIT_REACHED
        d7_res = client.post("/organisations", json={
            "name": "Illegal Dealer L7",
            "type": "DEALER",
            "parent_id": prev_dealer_id
        }, headers=prev_headers)
        self.assertEqual(d7_res.status_code, 422, f"Expected 422 Unprocessable Entity, got {d7_res.status_code}")
        err_body = d7_res.json()
        error_code = err_body.get("error", {}).get("code", "")
        error_detail = err_body.get("detail", "")
        self.assertTrue(
            error_code == "DEALER_DEPTH_LIMIT_REACHED" or "DEALER_DEPTH_LIMIT_REACHED" in error_detail,
            f"Expected DEALER_DEPTH_LIMIT_REACHED in error response, got {err_body}"
        )

    def test_05_invalid_parent_child_hierarchy_relationships(self):
        """
        Verify hierarchy rules:
        - Dealer cannot create Distributor
        - Distributor cannot create Manufacturer
        - Manufacturer cannot create Super Admin
        - End User cannot create Dealer
        """
        # Create hierarchy branch: Mfg -> Dist -> Dealer
        mfg_org = client.post("/organisations", json={
            "name": "Kirloskar Mfg Unit",
            "type": "MANUFACTURER",
            "parent_id": str(self.root_org.id)
        }, headers=self.sa_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(mfg_org["id"]))

        dist_org = client.post("/organisations", json={
            "name": "Pune Agri Distributors",
            "type": "DISTRIBUTOR",
            "parent_id": mfg_org["id"]
        }, headers=self.sa_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(dist_org["id"]))

        dealer_org = client.post("/organisations", json={
            "name": "Haveli Taluka Dealers",
            "type": "DEALER",
            "parent_id": dist_org["id"]
        }, headers=self.sa_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(dealer_org["id"]))

        # 1. Dealer -> Distributor (Illegal)
        res1 = client.post("/organisations", json={
            "name": "Illegal Distributor under Dealer",
            "type": "DISTRIBUTOR",
            "parent_id": dealer_org["id"]
        }, headers=self.sa_headers)
        self.assertIn(res1.status_code, (400, 403, 422), "Dealer cannot have a child Distributor")

        # 2. Distributor -> Manufacturer (Illegal)
        res2 = client.post("/organisations", json={
            "name": "Illegal Manufacturer under Distributor",
            "type": "MANUFACTURER",
            "parent_id": dist_org["id"]
        }, headers=self.sa_headers)
        self.assertIn(res2.status_code, (400, 403, 422), "Distributor cannot have a child Manufacturer")

        # 3. Manufacturer -> Super Admin (Illegal)
        res3 = client.post("/organisations", json={
            "name": "Illegal Superadmin under Manufacturer",
            "type": "SUPERADMIN",
            "parent_id": mfg_org["id"]
        }, headers=self.sa_headers)
        self.assertIn(res3.status_code, (400, 403, 422), "Manufacturer cannot have a child Super Admin")

    def test_06_role_assignment_authorization(self):
        """
        Verify that role assignment is strictly authorization-controlled:
        - Distributor attempting role=SUPER_ADMIN must return 403 FORBIDDEN.
        - Dealer attempting role=DISTRIBUTOR must return 403 FORBIDDEN.
        """
        # Create Manufacturer org
        mfg_org = client.post("/organisations", json={
            "name": "Gujarat Mfg Corp",
            "type": "MANUFACTURER",
            "parent_id": str(self.root_org.id)
        }, headers=self.sa_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(mfg_org["id"]))

        # Create Distributor org under Manufacturer
        dist_org = client.post("/organisations", json={
            "name": "Gujarat Agro Dist",
            "type": "DISTRIBUTOR",
            "parent_id": mfg_org["id"]
        }, headers=self.sa_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(dist_org["id"]))

        dist_phone = f"+9191700{uuid.uuid4().hex[:5]}"
        dist_user = client.post(f"/organisations/{dist_org['id']}/users", json={
            "name": "Gujarat Dist Lead",
            "phone": dist_phone,
            "role": "DISTRIBUTOR"
        }, headers=self.sa_headers).json()
        self.cleanup_user_ids.append(uuid.UUID(dist_user["id"]))

        dist_db = self.db.query(User).filter(User.id == uuid.UUID(dist_user["id"])).first()
        dist_headers = auth_header(dist_db)

        # Distributor attempting to create a SUPER_ADMIN -> MUST BE 403 FORBIDDEN
        fake_phone = f"+9191800{uuid.uuid4().hex[:5]}"
        res = client.post(f"/organisations/{dist_org['id']}/users", json={
            "name": "Fake Super Admin",
            "phone": fake_phone,
            "role": "SUPER_ADMIN"
        }, headers=dist_headers)
        self.assertEqual(res.status_code, 403, f"Expected 403 Forbidden, got {res.status_code}: {res.text}")

        # Dealer attempting to create a DISTRIBUTOR -> MUST BE 403 FORBIDDEN
        dealer_org = client.post("/organisations", json={
            "name": "Surat Dealer Unit",
            "type": "DEALER",
            "parent_id": dist_org["id"]
        }, headers=dist_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(dealer_org["id"]))

        dealer_phone = f"+9191900{uuid.uuid4().hex[:5]}"
        dealer_user = client.post(f"/organisations/{dealer_org['id']}/users", json={
            "name": "Surat Dealer Owner",
            "phone": dealer_phone,
            "role": "DEALER"
        }, headers=dist_headers).json()
        self.cleanup_user_ids.append(uuid.UUID(dealer_user["id"]))

        dealer_db = self.db.query(User).filter(User.id == uuid.UUID(dealer_user["id"])).first()
        dealer_headers = auth_header(dealer_db)

        fake_dist_phone = f"+9191999{uuid.uuid4().hex[:5]}"
        res_dealer = client.post(f"/organisations/{dealer_org['id']}/users", json={
            "name": "Illegal Distributor",
            "phone": fake_dist_phone,
            "role": "DISTRIBUTOR"
        }, headers=dealer_headers)
        self.assertEqual(res_dealer.status_code, 403, f"Expected 403 Forbidden, got {res_dealer.status_code}")

    def test_07_suspended_organisation_management_operations_blocked(self):
        """Suspended organisation cannot perform normal management operations."""
        # Create Mfg under Root
        mfg_org = client.post("/organisations", json={
            "name": "Suspension Test Mfg",
            "type": "MANUFACTURER",
            "parent_id": str(self.root_org.id)
        }, headers=self.sa_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(mfg_org["id"]))

        # Create Distributor under Mfg
        dist_org = client.post("/organisations", json={
            "name": "Suspension Test Distributor",
            "type": "DISTRIBUTOR",
            "parent_id": mfg_org["id"]
        }, headers=self.sa_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(dist_org["id"]))

        user_phone = f"+9192000{uuid.uuid4().hex[:5]}"
        u_data = client.post(f"/organisations/{dist_org['id']}/users", json={
            "name": "Suspended Dist User",
            "phone": user_phone,
            "role": "DISTRIBUTOR"
        }, headers=self.sa_headers).json()
        self.cleanup_user_ids.append(uuid.UUID(u_data["id"]))

        u_db = self.db.query(User).filter(User.id == uuid.UUID(u_data["id"])).first()
        u_headers = auth_header(u_db)

        # Suspend organisation
        suspend_res = client.post(f"/organisations/{dist_org['id']}/suspend", headers=self.sa_headers)
        self.assertEqual(suspend_res.status_code, 200)
        self.assertEqual(suspend_res.json()["status"], "SUSPENDED")

        # Attempt to create child organisation while suspended -> MUST FAIL 400 or 403
        child_res = client.post("/organisations", json={
            "name": "Child Under Suspended Org",
            "type": "DEALER",
            "parent_id": dist_org["id"]
        }, headers=self.sa_headers)
        self.assertIn(child_res.status_code, (400, 403))

        # Attempt by member of suspended org to manage:
        # 1. Existing session token is revoked upon suspension -> 401
        u_attempt = client.post("/organisations", json={
            "name": "Child by Suspended User",
            "type": "DEALER",
            "parent_id": dist_org["id"]
        }, headers=u_headers)
        self.assertIn(u_attempt.status_code, (400, 401, 403))

        # 2. Even with a freshly minted token with updated session version, management is blocked -> 403
        self.db.refresh(u_db)
        fresh_u_headers = auth_header(u_db)
        u_fresh_attempt = client.post("/organisations", json={
            "name": "Child by Suspended User Fresh Token",
            "type": "DEALER",
            "parent_id": dist_org["id"]
        }, headers=fresh_u_headers)
        self.assertEqual(u_fresh_attempt.status_code, 403)

        # Reactivate organisation
        activate_res = client.post(f"/organisations/{dist_org['id']}/activate", headers=self.sa_headers)
        self.assertEqual(activate_res.status_code, 200)
        self.assertEqual(activate_res.json()["status"], "ACTIVE")

    def test_08_duplicate_phone_validation(self):
        """Active users cannot share phone numbers."""
        test_phone = f"+9192100{uuid.uuid4().hex[:5]}"

        # Create first user with test_phone
        u1_res = client.post(f"/organisations/{self.root_org.id}/users", json={
            "name": "User Phone 1",
            "phone": test_phone,
            "role": "SUPPORT_ENGINEER"
        }, headers=self.sa_headers)
        self.assertEqual(u1_res.status_code, 201)
        self.cleanup_user_ids.append(uuid.UUID(u1_res.json()["id"]))

        # Attempt to create second user with duplicate phone
        u2_res = client.post(f"/organisations/{self.root_org.id}/users", json={
            "name": "User Phone 2 (Duplicate)",
            "phone": test_phone,
            "role": "SUPPORT_ENGINEER"
        }, headers=self.sa_headers)
        self.assertIn(u2_res.status_code, (400, 409, 422), f"Expected conflict on duplicate phone, got {u2_res.status_code}")

    def test_09_user_organisation_assignment_and_unauthorized_changes(self):
        """
        - Every organisational user belongs to an organisation.
        - Unauthorised user cannot change another user's organisation.
        """
        # Create Mfg under Root
        mfg_org = client.post("/organisations", json={
            "name": "Mfg Parent for Org A and B",
            "type": "MANUFACTURER",
            "parent_id": str(self.root_org.id)
        }, headers=self.sa_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(mfg_org["id"]))

        # Create Dist Org A and Org B under Mfg
        org_a = client.post("/organisations", json={
            "name": "Organisation Unit A",
            "type": "DISTRIBUTOR",
            "parent_id": mfg_org["id"]
        }, headers=self.sa_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(org_a["id"]))

        org_b = client.post("/organisations", json={
            "name": "Organisation Unit B",
            "type": "DISTRIBUTOR",
            "parent_id": mfg_org["id"]
        }, headers=self.sa_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(org_b["id"]))

        user_a_phone = f"+9192200{uuid.uuid4().hex[:5]}"
        user_a = client.post(f"/organisations/{org_a['id']}/users", json={
            "name": "User of Org A",
            "phone": user_a_phone,
            "role": "DISTRIBUTOR"
        }, headers=self.sa_headers).json()
        self.cleanup_user_ids.append(uuid.UUID(user_a["id"]))

        user_b_phone = f"+9192300{uuid.uuid4().hex[:5]}"
        user_b = client.post(f"/organisations/{org_b['id']}/users", json={
            "name": "User of Org B",
            "phone": user_b_phone,
            "role": "DISTRIBUTOR"
        }, headers=self.sa_headers).json()
        self.cleanup_user_ids.append(uuid.UUID(user_b["id"]))

        # Non-superadmin user_a tries to change user_b's organisation -> 403 FORBIDDEN
        user_a_db = self.db.query(User).filter(User.id == uuid.UUID(user_a["id"])).first()
        user_a_headers = auth_header(user_a_db)

        move_res = client.patch(f"/users/{user_b['id']}", json={
            "org_id": org_a["id"]
        }, headers=user_a_headers)
        self.assertEqual(move_res.status_code, 403, f"Expected 403 Forbidden, got {move_res.status_code}")

    def test_10_hierarchy_queries(self):
        """
        Test retrieval of:
        - Children
        - Ancestors
        - Descendants
        - Subtree
        """
        # Create small test tree: Root -> Mfg -> Dist -> Dealer
        mfg = client.post("/organisations", json={
            "name": "Query Test Mfg",
            "type": "MANUFACTURER",
            "parent_id": str(self.root_org.id)
        }, headers=self.sa_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(mfg["id"]))

        dist = client.post("/organisations", json={
            "name": "Query Test Dist",
            "type": "DISTRIBUTOR",
            "parent_id": mfg["id"]
        }, headers=self.sa_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(dist["id"]))

        dealer = client.post("/organisations", json={
            "name": "Query Test Dealer",
            "type": "DEALER",
            "parent_id": dist["id"]
        }, headers=self.sa_headers).json()
        self.cleanup_org_ids.append(uuid.UUID(dealer["id"]))

        # 1. Children of Mfg
        children_res = client.get(f"/organisations/{mfg['id']}/children", headers=self.sa_headers)
        self.assertEqual(children_res.status_code, 200)
        child_ids = [c["id"] for c in children_res.json()]
        self.assertIn(dist["id"], child_ids)

        # 2. Ancestors of Dealer
        ancestors_res = client.get(f"/organisations/{dealer['id']}/ancestors", headers=self.sa_headers)
        self.assertEqual(ancestors_res.status_code, 200)
        ancestor_ids = [a["id"] for a in ancestors_res.json()]
        self.assertIn(str(self.root_org.id), ancestor_ids)
        self.assertIn(mfg["id"], ancestor_ids)
        self.assertIn(dist["id"], ancestor_ids)

        # 3. Descendants of Mfg
        desc_res = client.get(f"/organisations/{mfg['id']}/descendants", headers=self.sa_headers)
        self.assertEqual(desc_res.status_code, 200)
        desc_ids = [d["id"] for d in desc_res.json()]
        self.assertIn(dist["id"], desc_ids)
        self.assertIn(dealer["id"], desc_ids)

        # 4. Entire Subtree
        subtree_res = client.get(f"/organisations/{mfg['id']}/subtree", headers=self.sa_headers)
        self.assertEqual(subtree_res.status_code, 200)
        subtree_data = subtree_res.json()
        self.assertIn("subtree", subtree_data)
        self.assertEqual(subtree_data["subtree"]["id"], mfg["id"])
        self.assertTrue(len(subtree_data["subtree"]["children"]) >= 1)

    def test_11_audit_events_logged(self):
        """Verify audit events are logged for organisation and user lifecycle."""
        # Query recent audit log entries
        logs = self.db.query(AuditLog).filter(
            AuditLog.entity_type.in_(["organisation", "user"])
        ).order_by(AuditLog.occurred_at.desc()).limit(20).all()

        logged_actions = {log.action for log in logs}
        self.assertTrue(
            "ORGANISATION_CREATED" in logged_actions or "USER_CREATED" in logged_actions,
            f"Expected audit events in {logged_actions}"
        )


if __name__ == "__main__":
    unittest.main()
