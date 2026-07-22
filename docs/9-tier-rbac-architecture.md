# 9-Tier Multi-Tenant RBAC Architecture & Device Registration Policy

## 1. 9-Tier Account Roles

The system enforces a strict 9-tier hierarchical multi-tenant access structure:

1. **Superadmin** (Platform Owner - Superuser)
2. **Manufacturer** (Control Panel OEM)
3. **Regional Distributor**
4. **Dealer Tier 1**
5. **Dealer Tier 2**
6. **Dealer Tier 3**
7. **Dealer Tier 4**
8. **Dealer Tier 5** (Local Installer / Electrician)
9. **End Customer** (Farmer / Domestic Pump Owner)

---

## 2. Device Registration & Assignment Privilege Policy

| Action / Privilege | Superadmin (Tier 1) | Tiers 2–8 (Mfg / Dist / Dealers) | End Customer (Tier 9) |
| :--- | :---: | :---: | :---: |
| **Register / Add New Device** | **ALLOWED ✅** | RESTRICTED ❌ | RESTRICTED ❌ |
| **Edit / Update Device Properties** | **ALLOWED ✅** | RESTRICTED ❌ | RESTRICTED ❌ |
| **Delete Device** | **ALLOWED ✅** | RESTRICTED ❌ | RESTRICTED ❌ |
| **Assign Device to Subordinate User** | **ALLOWED ✅** | **ALLOWED ✅** (Below own tier only) | RESTRICTED ❌ |
| **Remote Contactor Switch (ON/OFF)** | **ALLOWED ✅** | **ALLOWED ✅** (Owned fleet) | **ALLOWED ✅** (Owned pumps) |

---

## 3. Database Path-Enumeration Schema (`users` & `pumps`)

Every user and device item stores a string column `hierarchy_path`:
- **Example Path**: `"1111/2222/3333/4444/5555"`
- **Subordinate Scoping Query**:
  ```sql
  SELECT * FROM agripump.pumps 
  WHERE hierarchy_path LIKE 'parent_user_path/%'
  ```
- **Device Transfer / Assignment Query**:
  ```sql
  UPDATE agripump.pumps 
  SET owner_user_id = $1, hierarchy_path = $2 
  WHERE id = $3;
  ```
