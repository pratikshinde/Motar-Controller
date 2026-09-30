import uuid
from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app.models import User
from app.services.jwt_auth import sign_token

client = TestClient(app)
db = SessionLocal()
sa = db.query(User).filter(User.role == "superadmin").first()
if sa:
    token = sign_token({"sub": str(sa.id), "role": "superadmin", "hierarchy_path": sa.hierarchy_path or "/SA", "session_ver": sa.session_version or 1})
    client.headers = {"Authorization": f"Bearer {token}"}
db.close()

def test_user_module_flow():
    print("\n--- Testing User Module APIs ---")

    # 1. Validation Error: Missing both email and phone
    res = client.post("/users", json={"full_name": "No Contact User"})
    assert res.status_code in (400, 422), f"Expected 400/422, got {res.status_code}"
    print("[PASS] 1. POST /users (Validation: Email or phone required) -> Blocked as expected")

    # 2. Create User with Email and Phone
    email_1 = f"john.doe.{uuid.uuid4().hex[:6]}@example.com"
    phone_1 = f"+9198765{uuid.uuid4().hex[:5]}"
    res = client.post("/users", json={
        "full_name": "John Doe",
        "email": email_1,
        "phone": phone_1,
        "password": "SecretPassword123!"
    })
    assert res.status_code == 201, f"Expected 201, got {res.status_code}: {res.text}"
    user_1 = res.json()
    assert "password_hash" not in user_1, "password_hash MUST NOT be exposed in response!"
    assert user_1["full_name"] == "John Doe"
    assert user_1["email"] == email_1
    assert user_1["is_active"] is True
    assert user_1["is_verified"] is False
    print(f"[PASS] 2. POST /users (Full user) -> Created ID {user_1['id']}")

    # 3. Create User with Email only
    email_2 = f"alice.{uuid.uuid4().hex[:6]}@example.com"
    res = client.post("/users", json={
        "full_name": "Alice Smith",
        "email": email_2
    })
    assert res.status_code == 201, f"Expected 201, got {res.status_code}: {res.text}"
    user_2 = res.json()
    assert user_2["phone"] is None
    print(f"[PASS] 3. POST /users (Email only) -> Created ID {user_2['id']}")

    # 4. Create User with Phone only
    phone_3 = f"+9199887{uuid.uuid4().hex[:5]}"
    res = client.post("/users", json={
        "full_name": "Bob Operator",
        "phone": phone_3
    })
    assert res.status_code == 201, f"Expected 201, got {res.status_code}: {res.text}"
    user_3 = res.json()
    assert user_3["email"] is None
    print(f"[PASS] 4. POST /users (Phone only) -> Created ID {user_3['id']}")

    # 5. Duplicate Email Error Check
    res = client.post("/users", json={
        "full_name": "Duplicate Email Guy",
        "email": email_1
    })
    assert res.status_code == 400, f"Expected 400 Bad Request, got {res.status_code}"
    print("[PASS] 5. POST /users (Duplicate email check) -> 400 Bad Request")

    # 6. Duplicate Phone Error Check
    res = client.post("/users", json={
        "full_name": "Duplicate Phone Guy",
        "phone": phone_1
    })
    assert res.status_code == 400, f"Expected 400 Bad Request, got {res.status_code}"
    print("[PASS] 6. POST /users (Duplicate phone check) -> 400 Bad Request")

    # 7. GET /users (List all users)
    res = client.get("/users")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    users_list = res.json()
    assert len(users_list) >= 3
    for u in users_list:
        assert "password_hash" not in u, "password_hash leaked in list response!"
    print(f"[PASS] 7. GET /users -> Returned {len(users_list)} users safely")

    # 8. GET /users/{user_id} (Fetch single user)
    res = client.get(f"/users/{user_1['id']}")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    fetched = res.json()
    assert fetched["id"] == user_1["id"]
    assert "password_hash" not in fetched
    print(f"[PASS] 8. GET /users/{{id}} -> Successfully retrieved user {fetched['id']}")

    # 9. GET /users/{non_existent_uuid} (404 Error check)
    random_id = str(uuid.uuid4())
    res = client.get(f"/users/{random_id}")
    assert res.status_code == 404, f"Expected 404 Not Found, got {res.status_code}"
    print("[PASS] 9. GET /users/{non_existent_id} -> 404 Not Found as expected")

    print("\nSUCCESS: ALL USER MODULE TEST SUITES PASSED PERFECTLY!\n")

if __name__ == "__main__":
    test_user_module_flow()
