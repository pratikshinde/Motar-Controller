import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field

class UserCreate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=100, description="User's full name")
    email: Optional[str] = Field(None, description="Optional unique email address")
    phone: Optional[str] = Field(None, description="Optional phone number")
    phone_number: Optional[str] = Field(None, description="Optional phone number field")
    password: Optional[str] = Field(None, description="Optional plaintext password")
    role: Optional[str] = Field("dealer", description="User role: manufacturer, distributor, dealer, customer")
    parent_user_id: Optional[str] = Field(None, description="Parent user ID")
    parent_hierarchy_path: Optional[str] = Field(None, description="Parent hierarchy path")
    org_role: Optional[str] = Field("owner", description="Organization sub-role")
    membership: Optional[str] = Field(None, description="Staff membership flag")
    is_active: bool = Field(True, description="Whether user account is active")
    is_verified: bool = Field(False, description="Whether user contact details are verified")

class UserResponse(BaseModel):
    id: uuid.UUID
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    is_active: bool
    is_verified: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
