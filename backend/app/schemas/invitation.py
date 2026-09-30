"""
Invitation Schemas
Phase 2C: AgriPump SmartSpace Organisation Invitation & User Onboarding
"""
import uuid
from typing import Optional
from pydantic import BaseModel, Field


class InvitationCreate(BaseModel):
    phone: str = Field(..., description="E.164 formatted phone number (+91XXXXXXXXXX)")
    role: str = Field(..., description="Role to assign (MANUFACTURER, DISTRIBUTOR, DEALER, END_USER)")


class InvitationResponse(BaseModel):
    id: uuid.UUID
    token: Optional[str] = None
    phone: str
    role: str
    target_org_id: Optional[uuid.UUID] = None
    status: str
    expires_at: str
    created_at: Optional[str] = None


class InvitationPreviewResponse(BaseModel):
    role: str
    organisation_name: Optional[str] = None
    inviter_organisation_name: Optional[str] = None
    expires_at: str
    phone: Optional[str] = None


class InvitationAcceptRequest(BaseModel):
    phone: str = Field(..., description="Invited phone number confirming identity")
    full_name: Optional[str] = Field("User", description="User's full name")
    password: Optional[str] = Field(None, description="Account password (optional for customer)")
    otp: Optional[str] = Field(None, description="6-digit WhatsApp OTP code")
    phone_verification_token: Optional[str] = Field(None, description="Pre-verified phone ticket")
