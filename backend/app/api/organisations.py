"""
Organisations API Router
Provides REST endpoints for organisation hierarchy, subtree queries, and user management.
Phase 2A: AgriPump SmartSpace Backend
"""
import uuid
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.database import get_db
from app.models.user import User
from app.schemas.organisation import (
    OrganisationCreate, OrganisationUpdate, OrganisationResponse
)
from app.schemas.user import UserCreateInOrg, UserDetailResponse
from app.schemas.invitation import InvitationCreate, InvitationResponse
from app.services.organisation_service import OrganisationService
from app.services.user_service import UserService

router = APIRouter(tags=["Organisations"])


@router.get("", response_model=List[OrganisationResponse])
@router.get("/", response_model=List[OrganisationResponse], include_in_schema=False)
def list_organisations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Lists organisations visible to the caller within their hierarchical scope."""
    orgs = OrganisationService.list_organisations(db, current_user)
    return orgs


@router.post("", response_model=OrganisationResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=OrganisationResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
def create_organisation(
    req: OrganisationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Creates a new child organisation under an authorized parent.
    Enforces server-side hierarchy rules and max 6 dealer depth guard.
    """
    return OrganisationService.create_organisation(db, current_user, req)


@router.get("/{org_id}", response_model=OrganisationResponse)
def get_organisation(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Fetches details for a single organisation."""
    return OrganisationService.get_organisation(db, current_user, org_id)


@router.patch("/{org_id}", response_model=OrganisationResponse)
@router.put("/{org_id}", response_model=OrganisationResponse, include_in_schema=False)
def update_organisation(
    org_id: uuid.UUID,
    req: OrganisationUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Updates organisation details (name, branding, status)."""
    return OrganisationService.update_organisation(db, current_user, org_id, req)


@router.post("/{org_id}/suspend", response_model=OrganisationResponse)
def suspend_organisation(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Suspends an organisation and revokes active sessions for all descendant users."""
    return OrganisationService.suspend_organisation(db, current_user, org_id)


@router.post("/{org_id}/activate", response_model=OrganisationResponse)
def activate_organisation(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Activates an organisation."""
    return OrganisationService.activate_organisation(db, current_user, org_id)


@router.delete("/{org_id}", status_code=status.HTTP_200_OK)
def delete_organisation(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Deletes an empty organisation."""
    OrganisationService.delete_organisation(db, current_user, org_id)
    return {"message": "Organisation deleted successfully", "deleted_id": str(org_id)}


@router.get("/{org_id}/children", response_model=List[OrganisationResponse])
def get_organisation_children(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Returns direct children of an organisation."""
    return OrganisationService.get_children(db, current_user, org_id)


@router.get("/{org_id}/subtree")
def get_organisation_subtree(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Returns the full hierarchy subtree rooted at this organisation."""
    return OrganisationService.get_subtree(db, current_user, org_id)


@router.get("/{org_id}/ancestors", response_model=List[OrganisationResponse])
def get_organisation_ancestors(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Returns lineage of ancestors from root to this organisation."""
    return OrganisationService.get_ancestors(db, current_user, org_id)


@router.get("/{org_id}/descendants", response_model=List[OrganisationResponse])
def get_organisation_descendants(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Returns all descendant organisations."""
    return OrganisationService.get_descendants(db, current_user, org_id)


@router.get("/{org_id}/users", response_model=List[UserDetailResponse])
def get_organisation_users(
    org_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Returns all users belonging to this organisation."""
    users = UserService.get_users_by_organisation(db, current_user, org_id)
    return [
        UserDetailResponse(
            id=u.id,
            name=u.full_name,
            phone=u.phone or u.phone_number,
            role=u.role,
            org_id=u.org_id,
            status=u.status,
            mfa_enabled=u.mfa_enabled,
            locale=u.locale,
            created_at=u.created_at,
            updated_at=u.updated_at
        )
        for u in users
    ]


@router.post("/{org_id}/users", response_model=UserDetailResponse, status_code=status.HTTP_201_CREATED)
def create_organisation_user(
    org_id: uuid.UUID,
    req: UserCreateInOrg,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Creates a new user account under the specified organisation."""
    user = UserService.create_user(db, current_user, req, target_org_id=org_id)
    return UserDetailResponse(
        id=user.id,
        name=user.full_name,
        phone=user.phone or user.phone_number,
        role=user.role,
        org_id=user.org_id,
        status=user.status,
        mfa_enabled=user.mfa_enabled,
        locale=user.locale,
        created_at=user.created_at,
        updated_at=user.updated_at
    )


@router.post("/{org_id}/invitations", response_model=InvitationResponse, status_code=status.HTTP_201_CREATED)
def create_organisation_invitation(
    org_id: uuid.UUID,
    req: InvitationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    POST /organisations/{id}/invitations
    Invites a user/organisation under the specified organisation.
    """
    from app.services.invitation_service import InvitationService
    inv, token = InvitationService.create_invitation(db, current_user, org_id, req)
    return InvitationResponse(
        id=inv.id,
        token=token,
        phone=inv.phone,
        role=inv.target_role or inv.role,
        target_org_id=inv.target_org_id,
        status=inv.status,
        expires_at=inv.expires_at.isoformat() if inv.expires_at else "",
        created_at=inv.created_at.isoformat() if inv.created_at else None
    )
