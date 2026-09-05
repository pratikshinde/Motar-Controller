import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from passlib.context import CryptContext

from app.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserResponse
from app.services.jwt_auth import hash_secret

def hash_password(password: str) -> str:
    return hash_secret(password)

router = APIRouter(tags=["Users"])

@router.post("", status_code=status.HTTP_201_CREATED)
@router.post("/", status_code=status.HTTP_201_CREATED, include_in_schema=False)
def create_user(req: UserCreate, db: Session = Depends(get_db)):
    try:
        phone_val = req.phone_number or req.phone or f"9741{uuid.uuid4().hex[:6]}"
        clean_phone = phone_val.strip().replace(" ", "")

        parent_path = req.parent_hierarchy_path or "/SA"
        new_user_id = uuid.uuid4()
        hierarchy_path = f"{parent_path}/{new_user_id}"

        pwd_hash = hash_password(req.password) if req.password else hash_password("AgriPump123!")

        new_user = User(
            id=new_user_id,
            full_name=req.full_name.strip(),
            email=req.email.lower().strip() if req.email else f"user_{new_user_id.hex[:6]}@agripump.com",
            phone_number=clean_phone,
            password_hash=pwd_hash,
            role=req.role or "dealer",
            hierarchy_path=hierarchy_path,
            is_active=req.is_active,
            is_verified=req.is_verified
        )

        db.add(new_user)
        db.commit()
        db.refresh(new_user)

        return {
            "message": "User account created successfully",
            "user": {
                "id": str(new_user.id),
                "full_name": new_user.full_name,
                "phone_number": new_user.phone_number,
                "role": new_user.role,
                "hierarchy_path": new_user.hierarchy_path
            }
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Create user error: {str(e)}")

@router.get("", response_model=List[UserResponse])
@router.get("/", response_model=List[UserResponse], include_in_schema=False)
def list_users(db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.desc()).all()
    return users

@router.get("/tree")
def get_user_tree(db: Session = Depends(get_db)):
    users = db.query(User).all()
    root_node = {
        "id": "root",
        "name": "AgriPump Organization Root",
        "full_name": "AgriPump Organization Root",
        "role": "superadmin",
        "hierarchy_path": "/SA",
        "members": [],
        "children": [
            {
                "id": str(u.id),
                "name": u.full_name,
                "full_name": u.full_name,
                "role": u.role or "dealer",
                "phone": u.phone_number,
                "email": u.email,
                "hierarchy_path": u.hierarchy_path or "/SA",
                "members": [],
                "children": []
            }
            for u in users
        ]
    }
    return {
        "tree": [root_node],
        "data": [root_node]
    }

@router.get("/{user_id}", response_model=UserResponse)
def get_user_by_id(user_id: uuid.UUID, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with ID '{user_id}' not found"
        )
    return user
