import uuid
from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy.orm import Session
from app.models import Command, User
from app.repositories.pump_repository import PumpRepository

class CommandRepository:
    """
    Repository for dispatching and querying commands with tenant scoping.
    """

    def __init__(self, actor: User, db: Session):
        self.actor = actor
        self.db = db
        self.pump_repo = PumpRepository.for_actor(actor=actor, db=db)

    @classmethod
    def for_actor(cls, actor: User, db: Session) -> "CommandRepository":
        return cls(actor=actor, db=db)

    def get_by_id(self, command_id: uuid.UUID) -> Optional[Command]:
        """Fetch command by ID if pump is within actor's scope."""
        cmd = self.db.query(Command).filter(Command.cid == command_id).first()
        if not cmd:
            return None
        if not self.pump_repo.get_by_id(cmd.pump_id):
            return None
        return cmd

    def list_for_pump(self, pump_id: str, limit: int = 50) -> Optional[List[Command]]:
        """List command history for a pump. Returns None if pump out of scope."""
        if not self.pump_repo.get_by_id(pump_id):
            return None
        return (
            self.db.query(Command)
            .filter(Command.pump_id == pump_id)
            .order_by(Command.issued_at.desc())
            .limit(limit)
            .all()
        )

    def create(
        self,
        pump_id: str,
        action: str,
        expires_at: datetime
    ) -> Optional[Command]:
        """Create and queue a new command for pump. Returns None if pump out of scope."""
        pump = self.pump_repo.get_by_id(pump_id)
        if not pump:
            return None

        cmd = Command(
            cid=uuid.uuid4(),
            pump_id=pump_id,
            actor_id=self.actor.id,
            action=action,
            status="PENDING",
            issued_at=datetime.now(timezone.utc),
            expires_at=expires_at
        )
        self.db.add(cmd)
        self.db.commit()
        self.db.refresh(cmd)
        return cmd
