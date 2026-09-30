import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Command, User
from app.schemas.pump import CommandDetailResponse
from app.api.deps import get_current_user, get_pump_in_scope
from app.services.command_service import command_event

router = APIRouter(tags=["Commands"])

@router.get("/{cid}", response_model=CommandDetailResponse)
def get_command_status(
    cid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get command status by CID (Appendix H).
    """
    try:
        cmd_uuid = uuid.UUID(cid)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid command ID format")

    cmd = db.query(Command).filter(Command.cid == cmd_uuid).first()
    # A command is only visible to someone who can see its pump.
    if not cmd or not get_pump_in_scope(db, cmd.pump_id, current_user):
        raise HTTPException(status_code=404, detail="Command not found")

    return command_event(cmd)
