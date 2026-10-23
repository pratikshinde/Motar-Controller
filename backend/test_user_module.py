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

def _verify_phone(phone: str, purpose: str = "registration") -> str:
    sent = client.post("/auth/verify-phone/send", json={"phone_number": phone, "purpose": purpose})
    assert sent.status_code == 200, sent.text
    code = sent.json()["dev_otp"]
    confirmed = client.post("/auth/verify-phone/confirm", json={"phone_number": phone, "purpose": purpose, "code": code})
    assert confirmed.status_code == 200, confirmed.text
    return confirmed.json()["verification_token"]

def test_user_module_flow():
    print("\n--- Testing User Module APIs ---")

    # 1. Validation Error: Missing both email and phone
    res = client.post("/users", json={"full_name": "No Contact User"})
    assert res.status_code in (400, 422), f"Expected 400/422, got {res.status_code}"
    print("[PASS] 1. POST /users (Validation: Email or phone required) -> Blocked as expected")

    # 2. Create User with Email and Phone
    email_1 = f"john.doe.{uuid.uuid4().hex[:6]}@example.com"
    phone_1 = f"+9198765{uuid.uuid4().hex[:5]}"
    token_1 = _verify_phone(phone_1)
    res = client.post("/users", json={
        "full_name": "John Doe",
        "email": email_1,
        "phone": phone_1,
        "password": "SecretPassword123!",
        "phone_verification_token": token_1
    })
    assert res.status_code == 201, f"Expected 201, got {res.status_code}: {res.text}"
    body_1 = res.json()
    user_1 = body_1.get("user", body_1)
    assert "password_hash" not in user_1, "password_hash MUST NOT be exposed in response!"
    assert user_1["full_name"] == "John Doe"
    print(f"[PASS] 2. POST /users (Full user) -> Created ID {user_1['id']}")

    # 3. Create User with Email only
    email_2 = f"alice.{uuid.uuid4().hex[:6]}@example.com"
    res = client.post("/users", json={
        "full_name": "Alice Smith",
        "email": email_2,
        "password": "SecretPassword123!"
    })
    assert res.status_code == 201, f"Expected 201, got {res.status_code}: {res.text}"
    body_2 = res.json()
    user_2 = body_2.get("user", body_2)
    assert user_2.get("phone") is None
    print(f"[PASS] 3. POST /users (Email only) -> Created ID {user_2['id']}")

    # 4. Create User with Phone only
    phone_3 = f"+9199887{uuid.uuid4().hex[:5]}"
    token_3 = _verify_phone(phone_3)
    res = client.post("/users", json={
        "full_name": "Bob Operator",
        "phone": phone_3,
        "password": "SecretPassword123!",
        "phone_verification_token": token_3
    })
    assert res.status_code == 201, f"Expected 201, got {res.status_code}: {res.text}"
    body_3 = res.json()
    user_3 = body_3.get("user", body_3)
    assert user_3.get("email") is None
    print(f"[PASS] 4. POST /users (Phone only) -> Created ID {user_3['id']}")

    # 5. Duplicate Email Error Check
    res = client.post("/users", json={
        "full_name": "Duplicate Email Guy",
        "email": email_1,
        "password": "SecretPassword123!"
    })
    assert res.status_code in (400, 409), f"Expected 400/409, got {res.status_code}"
    print("[PASS] 5. POST /users (Duplicate email check) -> 400/409 Handled")

    # 6. Duplicate Phone Error Check
    token_dup = _verify_phone(phone_1)
    res = client.post("/users", json={
        "full_name": "Duplicate Phone Guy",
        "phone": phone_1,
        "password": "SecretPassword123!",
        "phone_verification_token": token_dup
    })
    assert res.status_code in (400, 409), f"Expected 400/409, got {res.status_code}"
    print("[PASS] 6. POST /users (Duplicate phone check) -> 400/409 Handled")

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
