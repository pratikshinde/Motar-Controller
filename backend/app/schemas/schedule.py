"""The weekly schedule as the farmer app sends and reads it (the app's contract: mobile/openapi/farmer.json)."""
from typing import List, Optional

from pydantic import BaseModel, Field


class ScheduleEntryIn(BaseModel):
    day_of_week: int = Field(..., ge=0, le=6, description="0 = Monday ... 6 = Sunday")
    on_time: str = Field(..., description="HH:MM, 24-hour, in the schedule's time zone")
    off_time: str = Field(..., description="HH:MM, later the same day")
    enabled: bool = True


class ScheduleIn(BaseModel):
    enabled: bool
    entries: List[ScheduleEntryIn] = Field(default_factory=list, max_length=50)
    timezone: Optional[str] = Field(None, description="IANA name; keeps the current one (default Asia/Kolkata)")


class ScheduleEntryOut(BaseModel):
    id: str
    day_of_week: int
    on_time: str
    off_time: str
    enabled: bool


class ScheduleLimitsOut(BaseModel):
    min_window_minutes: int
    min_gap_minutes: int
    max_rows: int


class ScheduleNextOut(BaseModel):
    kind: str = Field(..., description="START (switch ON) or STOP (switch OFF)")
    at: str
    local: str = Field(..., description="e.g. 'Mon 11:00', in the schedule's time zone (English, ready to show)")
    day_of_week: int = Field(..., description="0 = Monday ... 6 = Sunday, in the schedule's time zone")
    time: str = Field(..., description="HH:MM in the schedule's time zone")


class ScheduleRunOut(BaseModel):
    kind: str
    due_at: str
    local: str
    day_of_week: int
    time: str
    outcome: str = Field(
        ..., description="PENDING, SENT, ALREADY_ON, ALREADY_OFF, SKIPPED_FAULT, BLOCKED, MISSED, GAVE_UP or CANCELLED"
    )
    detail: Optional[str] = None
    command_status: Optional[str] = Field(None, description="the START / STOP command's own state, once one was sent")


class ScheduleOut(BaseModel):
    pump_id: str
    enabled: bool
    timezone: str
    entries: List[ScheduleEntryOut]
    next: Optional[ScheduleNextOut] = None
    recent: List[ScheduleRunOut]
    limits: ScheduleLimitsOut
    server_time: str
