import uuid
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class OrganisationBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=150, description="Organisation name")
    type: str = Field(..., description="Organisation type: SUPERADMIN, MANUFACTURER, DISTRIBUTOR, DEALER")
    parent_id: Optional[uuid.UUID] = Field(None, description="Immediate parent organisation ID")
    branding_id: Optional[uuid.UUID] = Field(None, description="Optional branding ID")


class OrganisationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=150, description="Organisation name")
    type: str = Field(..., description="Organisation type: SUPERADMIN, MANUFACTURER, DISTRIBUTOR, DEALER")
    parent_id: Optional[uuid.UUID] = Field(None, description="Immediate parent organisation ID")
    branding_id: Optional[uuid.UUID] = Field(None, description="Optional branding ID")


class OrganisationUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=150)
    branding_id: Optional[uuid.UUID] = None
    status: Optional[str] = Field(None, description="ACTIVE, SUSPENDED, DISABLED")


class OrganisationResponse(BaseModel):
    id: uuid.UUID
    parent_id: Optional[uuid.UUID] = None
    type: str
    name: str
    status: str
    branding_id: Optional[uuid.UUID] = None
    depth: int
    path: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OrganisationTreeNode(BaseModel):
    id: uuid.UUID
    parent_id: Optional[uuid.UUID] = None
    type: str
    name: str
    status: str
    depth: int
    path: Optional[str] = None
    branding_id: Optional[uuid.UUID] = None
    children: List["OrganisationTreeNode"] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)
