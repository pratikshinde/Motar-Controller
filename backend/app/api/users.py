"""User management for the partner portal (FR-WEB-035, FR-WEB-012).

Everything here needs a signed-in partner (superadmin, manufacturer, distributor or dealer). A partner sees and
manages only the accounts in their own sub-tree; nobody can create an account above their own level, and the
platform-owner role can never be created through the API.
"""
import logging
import secrets
import uuid
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.phone import normalize_phone
from app.core.scope import in_subtree, path_in_scope
from app.database import get_db
from app.models import AppBrand, AuditLog, Pump
from app.models.user import User
from app.schemas.user import UserCreate, UserResponse, UserUpdate
from app.services.cache_service import cache_service
from app.services.jwt_auth import hash_secret
from app.services.phone_verification import redeem_phone_verification
from app.services import brand_service

logger = logging.getLogger("agripump.users")
router = APIRouter(tags=["Users"])

PARTNER_ROLES = ["superadmin", "manufacturer", "distributor", "dealer"]

# Who may create whom (mirrors web/src/api/users.ts, which only offers what the server accepts).
ASSIGNABLE_ROLES: Dict[str, List[str]] = {
    "superadmin": ["manufacturer", "distributor", "dealer", "customer", "support"],
    "manufacturer": ["distributor", "dealer", "customer"],
    "distributor": ["dealer", "customer"],
    "dealer": ["dealer", "customer"],
    "customer": [],
}
MAX_DEALER_DEPTH = 6          # FR-SEC-000a
MIN_PARTNER_PASSWORD = 8

partner_only = require_roles(PARTNER_ROLES)


def _path_in_scope(actor: User, path: Optional[str]) -> bool:
    """True when `path` is the actor's own node or below it. /SA/D1 does not cover /SA/D10."""
    return actor.role == "superadmin" or path_in_scope(actor.hierarchy_path, path)


def _scoped_users(db: Session, actor: User):
    query = db.query(User)
    if actor.role == "superadmin":
        return query
    if not (actor.hierarchy_path or "").rstrip("/"):
        return query.filter(User.id == actor.id)
    return query.filter(in_subtree(User.hierarchy_path, actor.hierarchy_path))


def _get_in_scope(db: Session, actor: User, user_id: uuid.UUID) -> User:
    # One message for "missing" and "not yours": do not confirm that an id exists outside the caller's tree.
    target = db.query(User).filter(User.id == user_id).first()
    if not target or not (target.id == actor.id or _path_in_scope(actor, target.hierarchy_path)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return target


def _audit(db: Session, actor: User, target_id, action: str, before=None, after=None) -> None:
    db.add(AuditLog(
        actor_id=actor.id, actor_role=actor.role, entity_type="user", entity_id=str(target_id),
        action=action, before_json=before, after_json=after,
    ))


def _node(u: User) -> dict:
    return {
        "id": str(u.id),
        "name": u.full_name,
        "full_name": u.full_name,
        "role": u.role,
        "phone": u.phone_number or u.phone,
        "phone_number": u.phone_number or u.phone,
        "email": u.email,
        "hierarchy_path": u.hierarchy_path,
        "dealer_depth": u.dealer_depth,
        "parent_user_id": str(u.parent_user_id) if u.parent_user_id else None,
        "org_role": u.org_role,
        "account_status": u.account_status,
        "contract_notes": u.contract_notes,
        "device_quota": u.device_quota,
        "totp_enabled": bool(u.totp_enabled),
        "members": [],
        "children": [],
    }


@router.get("", response_model=List[UserResponse])
@router.get("/", response_model=List[UserResponse], include_in_schema=False)
def list_users(current_user: User = Depends(partner_only), db: Session = Depends(get_db)):
    return _scoped_users(db, current_user).order_by(User.created_at.desc()).all()


@router.get("/tree")
def get_user_tree(current_user: User = Depends(partner_only), db: Session = Depends(get_db)):
    users = _scoped_users(db, current_user).order_by(User.created_at).all()
    nodes = {u.id: _node(u) for u in users}

    def login_entry(n: dict) -> dict:
        """One login as it is listed in `members`: the account itself, without the branches under it."""
        return {k: v for k, v in n.items() if k not in ("members", "children")}

    roots: List[dict] = []
    for u in users:
        node = nodes[u.id]
        host = nodes.get(u.org_node_id) if u.org_node_id else None
        parent = nodes.get(u.parent_user_id) if u.parent_user_id else None
        if host is not None and host is not node:
            host["members"].append(login_entry(node))          # a colleague in the same organisation unit
            continue
        # `members` lists every login of the unit, the unit's own owner first (the portal counts "N logins" and
        # builds its account pickers from it).
        node["members"].insert(0, login_entry(node))
        if parent is not None:
            parent["children"].append(node)
        else:
            roots.append(node)

    if current_user.role == "superadmin":
        roots = [{**_node(current_user), "id": "root", "name": "AgriPump Organization Root",
                  "full_name": "AgriPump Organization Root", "hierarchy_path": "/SA", "children": roots}]
    return {"tree": roots, "data": roots}


@router.get("/{user_id}", response_model=UserResponse)
def get_user_by_id(user_id: uuid.UUID, current_user: User = Depends(partner_only), db: Session = Depends(get_db)):
    return _get_in_scope(db, current_user, user_id)


@router.post("", status_code=status.HTTP_201_CREATED)
@router.post("/", status_code=status.HTTP_201_CREATED, include_in_schema=False)
def create_user(req: UserCreate, current_user: User = Depends(partner_only), db: Session = Depends(get_db)):
    staff = (req.membership or "").lower() == "staff"

    # Where in the tree: under `parent` (a colleague joins that node's unit; anyone else becomes its child).
    parent = current_user
    if req.parent_user_id:
        try:
            parent = _get_in_scope(db, current_user, uuid.UUID(req.parent_user_id))
        except ValueError:
            raise HTTPException(status_code=422, detail="parent_user_id is not a valid id")
    elif req.parent_hierarchy_path:
        parent = (
            db.query(User).filter(User.hierarchy_path == req.parent_hierarchy_path.rstrip("/")).first()
        )
        if not parent or not (parent.id == current_user.id or _path_in_scope(current_user, parent.hierarchy_path)):
            raise HTTPException(status_code=404, detail="Parent account not found")

    if staff:
        role = parent.role                       # same role, same device pool, no new branch of the tree
        path = parent.hierarchy_path
        depth = parent.dealer_depth
        org_node = parent.org_node_id or parent.id
        org_role = req.org_role if req.org_role in ("staff", "readonly") else "staff"
    else:
        role = (req.role or "dealer").lower()
        allowed = ASSIGNABLE_ROLES.get(current_user.role, [])
        if role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"A {current_user.role} account cannot create a {role} account.",
            )
        new_id = uuid.uuid4()
        path = f"{parent.hierarchy_path.rstrip('/')}/{new_id}"
        depth = (parent.dealer_depth + 1) if (role == "dealer" and parent.role == "dealer") else (1 if role == "dealer" else 0)
        if depth > MAX_DEALER_DEPTH:
            raise HTTPException(status_code=422, detail=f"Dealer sub-levels are limited to {MAX_DEALER_DEPTH}.")
        org_node, org_role = None, "owner"

    # Partner accounts sign in with a password and must have one; a farmer signs in with an SMS code and needs none.
    password = req.password
    if role != "customer" or staff:
        if not password or len(password) < MIN_PARTNER_PASSWORD:
            raise HTTPException(status_code=422, detail=f"A password of at least {MIN_PARTNER_PASSWORD} characters is required.")
    phone = normalize_phone(req.phone_number or req.phone or "") or None

    email = req.email.lower().strip() if req.email else None
    if email and db.query(User.id).filter(User.email == email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That phone number or email is already registered.")
    if phone and db.query(User.id).filter((User.phone == phone) | (User.phone_number == phone)).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That phone number or email is already registered.")

    # The caller (a dealer, typically) is not the phone's owner, so it does not get to just assert this number
    # is real - it must present a ticket proving *someone* answered a WhatsApp code sent to it just now
    # (dealer-waits-for-the-code onboarding). An email-only account (no phone at all) has nothing to verify.
    phone_verified = False
    if phone:
        redeem_phone_verification(db, phone, "registration", req.phone_verification_token)
        phone_verified = True

    user = User(
        id=uuid.uuid4() if staff else new_id,
        full_name=req.full_name.strip(),
        email=email,
        phone_number=phone,
        phone=phone,
        password_hash=hash_secret(password) if password else None,
        role=role,
        hierarchy_path=path,
        parent_user_id=parent.parent_user_id if staff else parent.id,
        dealer_depth=depth,
        org_node_id=org_node,
        org_role=org_role,
        brand_id=brand_service.brand_id_for_new_account(db, role, parent=parent, creator=current_user, requested_key=req.brand,
                                                         explicit_for_manufacturer=True),
        is_active=req.is_active,
        is_verified=phone_verified,
    )
    db.add(user)
    try:
        db.flush()
        if role == "manufacturer" and not staff and user.brand_id is not None:
            # The first manufacturer account of a brand IS that manufacturer (its tree is the manufacturer's dashboard).
            brand_row = db.query(AppBrand).filter(AppBrand.id == user.brand_id, AppBrand.owner_user_id.is_(None)).first()
            if brand_row is not None:
                brand_row.owner_user_id = user.id
        _audit(db, current_user, user.id, "USER_CREATED", after={"role": role, "parent": str(parent.id), "staff": staff})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That phone number or email is already registered.")
    db.refresh(user)

    return {
        "message": "User account created successfully",
        "user": {
            "id": str(user.id),
            "full_name": user.full_name,
            "phone_number": user.phone_number,
            "role": user.role,
            "hierarchy_path": user.hierarchy_path,
        },
    }


@router.patch("/{user_id}")
@router.put("/{user_id}")
def update_user(user_id: uuid.UUID, req: UserUpdate, current_user: User = Depends(partner_only), db: Session = Depends(get_db)):
    from app.services.user_service import UserService
    # Check if org_id is being changed by an unauthorised user
    changes = req.model_dump(exclude_unset=True)
    if "org_id" in changes and changes["org_id"] is not None:
        if current_user.role != "superadmin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorised: only superadmin may change a user's organisation."
            )
    user = UserService.update_user(db, current_user, user_id, req)
    return {"message": "Account updated", "user": _node(user)}


@router.post("/{user_id}/suspend")
def suspend_user(user_id: uuid.UUID, current_user: User = Depends(partner_only), db: Session = Depends(get_db)):
    from app.services.user_service import UserService
    user = UserService.suspend_user(db, current_user, user_id)
    return {"message": "User suspended successfully", "user": _node(user)}


@router.post("/{user_id}/activate")
def activate_user(user_id: uuid.UUID, current_user: User = Depends(partner_only), db: Session = Depends(get_db)):
    from app.services.user_service import UserService
    user = UserService.activate_user(db, current_user, user_id)
    return {"message": "User activated successfully", "user": _node(user)}


@router.post("/{user_id}/role")
def change_user_role(user_id: uuid.UUID, req: UserUpdate, current_user: User = Depends(partner_only), db: Session = Depends(get_db)):
    from app.services.user_service import UserService
    if not req.role:
        raise HTTPException(status_code=422, detail="role is required")
    user = UserService.assign_role(db, current_user, user_id, req.role)
    return {"message": "User role updated successfully", "user": _node(user)}


@router.delete("/{user_id}")
def delete_user(user_id: uuid.UUID, current_user: User = Depends(require_roles(["superadmin"])), db: Session = Depends(get_db)):
    """Superadmin only, and only for an account that owns nothing: deleting one that owns pumps would delete the pumps."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == current_user.id:
        raise HTTPException(status_code=403, detail="You cannot delete your own account.")
    if target.role == "superadmin":
        raise HTTPException(status_code=403, detail="A platform-owner account cannot be deleted here.")
    owns_pumps = db.query(Pump.id).filter(Pump.owner_user_id == target.id).first() is not None
    has_children = db.query(User.id).filter((User.parent_user_id == target.id) | (User.org_node_id == target.id)).first() is not None
    if owns_pumps or has_children:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This account still owns devices or has accounts beneath it. Suspend it instead, or move them first.",
        )
    _audit(db, current_user, target.id, "USER_DELETED", before={"role": target.role, "name": target.full_name})
    db.delete(target)
    db.commit()
    return {"message": "Account deleted", "deleted_id": str(user_id)}

