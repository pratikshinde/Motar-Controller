import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator


class UserCreate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=100, description="User's full name")
    name: Optional[str] = Field(None, min_length=1, max_length=100, description="User's name alias")
    email: Optional[str] = Field(None, description="Optional unique email address")
    phone: Optional[str] = Field(None, description="Optional phone number")
    phone_number: Optional[str] = Field(None, description="Optional phone number field")
    password: Optional[str] = Field(None, description="Optional plaintext password")
    role: Optional[str] = Field("dealer", description="User role: SUPER_ADMIN, PANEL_MANUFACTURER, DISTRIBUTOR, DEALER, SUPPORT_ENGINEER, END_USER")
    org_id: Optional[uuid.UUID] = Field(None, description="Organisation ID")
    parent_user_id: Optional[str] = Field(None, description="Parent user ID")
    parent_hierarchy_path: Optional[str] = Field(None, description="Parent hierarchy path")
    org_role: Optional[str] = Field("owner", description="Organization sub-role")
    membership: Optional[str] = Field(None, description="Staff membership flag")
    locale: Optional[str] = Field("en", description="User preferred locale")
    is_active: bool = Field(True, description="Whether user account is active")
    phone_verification_token: Optional[str] = Field(None, description="Ticket from POST /auth/verify-phone/confirm")

    @model_validator(mode='after')
    def check_contact_and_name(self):
        # Resolve full_name vs name
        if not self.full_name and self.name:
            self.full_name = self.name
        elif not self.full_name and not self.name:
            raise ValueError('Name is required')

        # Check contact info
        if not self.email and not self.phone and not self.phone_number:
            raise ValueError('Either email or phone must be provided')
        return self


class UserCreateInOrg(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100, description="User name")
    full_name: Optional[str] = Field(None, min_length=1, max_length=100, description="User full name")
    phone: Optional[str] = Field(None, description="Unique phone number")
    phone_number: Optional[str] = Field(None, description="Phone number alias")
    email: Optional[str] = Field(None, description="Optional email address")
    role: str = Field(..., description="User role: SUPER_ADMIN, PANEL_MANUFACTURER, DISTRIBUTOR, DEALER, SUPPORT_ENGINEER, END_USER")
    locale: Optional[str] = Field("en", description="Locale")
    password: Optional[str] = Field(None, description="Optional password for dashboard login")

    @model_validator(mode='after')
    def validate_fields(self):
        if not self.name and self.full_name:
            self.name = self.full_name
        elif not self.name and not self.full_name:
            raise ValueError("Name is required")
        if not self.phone and self.phone_number:
            self.phone = self.phone_number
        if not self.phone:
            raise ValueError("Phone number is required")
        return self


class UserResponse(BaseModel):
    id: uuid.UUID
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    is_active: bool
    is_verified: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class UserDetailResponse(BaseModel):
    id: uuid.UUID
    name: str
    phone: Optional[str] = None
    role: str
    org_id: Optional[uuid.UUID] = None
    status: str
    mfa_enabled: bool
    locale: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class UserUpdate(BaseModel):
    """What a partner may change on an account below them (FR-WEB-012)."""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    full_name: Optional[str] = Field(None, min_length=1, max_length=100)
    phone: Optional[str] = None
    email: Optional[str] = None
    contract_notes: Optional[str] = Field(None, max_length=2000)
    device_quota: Optional[int] = Field(None, ge=0)
    account_status: Optional[str] = None
    status: Optional[str] = None
    locale: Optional[str] = None
    role: Optional[str] = None
    org_id: Optional[uuid.UUID] = None


class UserRoleUpdate(BaseModel):
    role: str = Field(..., description="New role to assign")
