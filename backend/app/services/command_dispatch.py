"""Sending a queued command to its pump, and telling clients what happened (P2.4).

`dispatch_command` runs after the HTTP response (FastAPI background task): it publishes the command and
moves it QUEUED -> SENT, or QUEUED -> FAILED if the broker did not take it. Every state change, from here or
from an ack / reading / sweep, is announced to WebSocket subscribers as a `command` message.

Device-side command contract:
- AC_3PH: START / STOP activates/deactivates the pump contactor.
- SOLAR_VFD: START = write 0001h to Fuji FRENIC-Ace S06 (run command FWD).
             STOP  = write 0000h to Fuji FRENIC-Ace S06 (stop command).
  Device firmware carries out the Modbus RTU communication over Port 2 (DX+/DX-) with H30=6.
  The platform uses the exact same command types ("START", "STOP") and lifecycle.
"""
from __future__ import annotations

import logging
import uuid
from typing import Iterable, List, Optional, Tuple

from fastapi.concurrency import run_in_threadpool

from app.database import system_session
from app.models import Command, Pump
from app.services import command_service as cs
from app.services.iot_publisher import PublishError, build_envelope, command_topic, get_publisher
from app.services.ws_hub import ws_hub

logger = logging.getLogger("agripump.commands")

# (WebSocket `command` payload, pump hierarchy path used to scope who receives it)
Announcement = Tuple[dict, Optional[str]]


def announcements(db, commands: Iterable[Command]) -> List[Announcement]:
    commands = list(commands)
    if not commands:
        return []
    paths = dict(db.query(Pump.id, Pump.hierarchy_path).filter(Pump.id.in_({c.pump_id for c in commands})).all())
    return [(cs.command_event(c), paths.get(c.pump_id)) for c in commands]


async def announce(items: Iterable[Announcement]) -> None:
    for event, path in items:
        try:
            await ws_hub.broadcast_command_update(event["pump_id"], event, path)
        except Exception:
            logger.exception("Could not announce command %s", event.get("cid"))


def _dispatch(cid: uuid.UUID) -> List[Announcement]:
    with system_session() as db:
        cmd = db.query(Command).filter(Command.cid == cid).with_for_update().first()
        if cmd is None or cmd.status != cs.QUEUED:
            return []  # already handled (a duplicate task), or gone
        if cs.now_utc() > cs.aware(cmd.expires_at):
            cs.advance(db, cmd, cs.EXPIRED, reason="not_sent_in_time")
        else:
            try:
                get_publisher().publish(command_topic(cmd.pump_id), build_envelope(cmd))
            except PublishError as exc:
                cs.advance(db, cmd, cs.FAILED, reason=exc.code)
            else:
                cs.advance(db, cmd, cs.SENT)
        db.commit()
        return announcements(db, [cmd])


async def dispatch_command(cid: uuid.UUID) -> None:
    """Publish command `cid` and announce the result."""
    try:
        await announce(await run_in_threadpool(_dispatch, cid))
    except Exception:
        logger.exception("Dispatching command %s failed", cid)


def _sweep() -> List[Announcement]:
    with system_session() as db:
        return announcements(db, cs.sweep_open_commands(db))


async def sweep_once() -> int:
    items = await run_in_threadpool(_sweep)
    await announce(items)
    return len(items)
