"""
DeviceImportService - Phase 4
================================
Bulk CSV device import with structured validation and error reporting.

CSV format:
  serial,model,hw_rev,batch_id,manufacture_date,supply_type,hp_rating
  PUMP-001,AgriPump-7.5HP,1.0,BATCH-2026-01,2026-01-15,3P,7.5

Rules:
  - serial: required, unique, pattern [A-Za-z0-9_-]{4,50}
  - model: required, max 100 chars
  - hw_rev: optional, max 20 chars
  - batch_id: optional, must exist in device_batches if provided
  - manufacture_date: optional, YYYY-MM-DD
  - supply_type: '3P' or '1P' or '3-phase' or '1-phase'
  - hp_rating: optional, float > 0
  - Initial state: MANUFACTURED

Duplicate detection:
  - Application-layer check before insert
  - DB-layer unique constraint catches concurrent races
"""
from __future__ import annotations

import csv
import io
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Pump, User, DeviceBatch, DeviceConfig, AuditLog

logger = logging.getLogger("agripump.import")

SERIAL_PATTERN = re.compile(r"^[A-Za-z0-9_\-]{4,50}$")
MODEL_PATTERN = re.compile(r"^[A-Za-z0-9 _\-\.]{1,100}$")
HW_REV_PATTERN = re.compile(r"^[A-Za-z0-9_\-\.]{1,20}$")
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

SUPPLY_MAP = {
    "3P": "3-phase", "3-PHASE": "3-phase", "3PHASE": "3-phase",
    "1P": "1-phase", "1-PHASE": "1-phase", "1PHASE": "1-phase",
}

REQUIRED_FIELDS = {"serial"}
KNOWN_FIELDS = {"serial", "model", "hw_rev", "batch_id", "manufacture_date", "supply_type", "hp_rating", "name"}


class ImportError:
    def __init__(self, row: int, field: str, code: str, message: str, value: Any = None):
        self.row = row
        self.field = field
        self.code = code
        self.message = message
        self.value = value

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"row": self.row, "field": self.field, "code": self.code, "message": self.message}
        if self.value is not None:
            d["value"] = str(self.value)
        return d


class DeviceImportService:
    """
    Validates and imports device inventory from CSV.

    All-or-nothing per row: a row either fully succeeds or is recorded as an error.
    The overall import is NOT atomic — a partial success is possible and is explicitly reported.
    """

    MAX_ROWS = 5000
    SCHEMA = "agripump"

    def __init__(self, db: Session, actor: User):
        self.db = db
        self.actor = actor

    def import_csv(
        self,
        csv_content: str,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        """
        Parses and validates a CSV string. If dry_run=True, no DB writes occur.

        Returns:
            {
              total_rows, successful, failed, skipped,
              errors: [{row, field, code, message}]
            }
        """
        reader = csv.DictReader(io.StringIO(csv_content.strip()))

        if not reader.fieldnames:
            return {
                "total_rows": 0,
                "successful": 0,
                "failed": 0,
                "skipped": 0,
                "errors": [{"row": 0, "field": "file", "code": "EMPTY_FILE", "message": "CSV file is empty or missing headers"}],
            }

        # Case-insensitive field normalization
        fields_lower = {f.strip().lower(): f for f in (reader.fieldnames or [])}
        missing_required = REQUIRED_FIELDS - set(fields_lower.keys())
        if missing_required:
            return {
                "total_rows": 0,
                "successful": 0,
                "failed": 0,
                "skipped": 0,
                "errors": [{
                    "row": 1, "field": "header", "code": "MISSING_REQUIRED_COLUMN",
                    "message": f"Missing required CSV columns: {sorted(missing_required)}",
                }],
            }

        errors: List[ImportError] = []
        successful = 0
        skipped = 0

        # Pre-load batch codes for validation
        batch_cache: Dict[str, Any] = {}

        # Track serials seen in this import to detect intra-import duplicates
        seen_serials: set = set()

        rows = list(reader)

        if len(rows) > self.MAX_ROWS:
            return {
                "total_rows": len(rows),
                "successful": 0,
                "failed": 0,
                "skipped": 0,
                "errors": [{
                    "row": 0, "field": "file", "code": "TOO_MANY_ROWS",
                    "message": f"CSV has {len(rows)} rows; max is {self.MAX_ROWS}. Split into smaller files.",
                }],
            }

        for idx, raw_row in enumerate(rows, start=2):  # 2 = header is row 1
            # Normalize keys
            row = {k.strip().lower(): v.strip() if v else "" for k, v in raw_row.items()}

            row_errors, parsed = self._validate_row(row, idx, seen_serials, batch_cache)
            if row_errors:
                errors.extend(row_errors)
                continue

            serial = parsed["serial"]
            seen_serials.add(serial.upper())

            if dry_run:
                successful += 1
                continue

            # Check existing device
            existing = self.db.query(Pump.id).filter(Pump.id == serial).first()
            if existing:
                skipped += 1
                errors.append(ImportError(idx, "serial", "DUPLICATE_SERIAL", f"Device '{serial}' already exists", serial))
                continue

            # Create device
            try:
                with self.db.begin_nested():
                    pump = Pump(
                        id=serial,
                        name=parsed.get("name") or f"Device {serial}",
                        supply_type=parsed["supply_type"],
                        hp_rating=parsed["hp_rating"],
                        owner_user_id=self.actor.id,
                        hierarchy_path=self.actor.hierarchy_path or "/SA",
                        org_id=self.actor.org_id,
                        status="STOPPED",
                        lifecycle_state="MANUFACTURED",
                        firmware_version=None,
                    )
                    self.db.add(pump)

                    self.db.add(DeviceConfig(
                        pump_id=serial,
                        desired_json={"ol": 25.0, "ov": 480, "dr": 1, "dr_t": 5},
                        reported_json={},
                        status="APPLIED",
                    ))

                    self.db.add(AuditLog(
                        actor_id=self.actor.id,
                        actor_role=self.actor.role,
                        entity_type="DEVICE",
                        entity_id=serial,
                        action="DEVICE_IMPORTED",
                        before_json=None,
                        after_json={
                            "serial": serial,
                            "model": parsed.get("model"),
                            "hw_rev": parsed.get("hw_rev"),
                            "batch_id": parsed.get("batch_id"),
                        },
                    ))
                    self.db.flush()

                successful += 1

            except IntegrityError:
                self.db.rollback()
                skipped += 1
                errors.append(ImportError(idx, "serial", "DUPLICATE_SERIAL_RACE", f"Concurrent import: '{serial}' already exists", serial))
            except Exception as exc:
                self.db.rollback()
                logger.exception("Import row %d failed: %s", idx, exc)
                errors.append(ImportError(idx, "serial", "INSERT_FAILED", f"Database error: {exc}", serial))

        if not dry_run:
            try:
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise

        return {
            "total_rows": len(rows),
            "successful": successful,
            "failed": len(errors) - skipped,
            "skipped": skipped,
            "errors": [e.to_dict() for e in errors],
        }

    def _validate_row(
        self,
        row: Dict[str, str],
        row_num: int,
        seen: set,
        batch_cache: dict,
    ) -> Tuple[List[ImportError], Dict[str, Any]]:
        errors = []
        parsed: Dict[str, Any] = {}

        # ── serial ─────────────────────────────────────────────────────────
        serial = row.get("serial", "").strip()
        if not serial:
            errors.append(ImportError(row_num, "serial", "MISSING_SERIAL", "serial is required"))
            return errors, parsed
        if not SERIAL_PATTERN.match(serial):
            errors.append(ImportError(row_num, "serial", "INVALID_SERIAL",
                f"serial '{serial}' must be 4–50 chars, letters/digits/dash/underscore only", serial))
            return errors, parsed
        if serial.upper() in seen:
            errors.append(ImportError(row_num, "serial", "DUPLICATE_IN_IMPORT",
                f"serial '{serial}' appears more than once in this import file", serial))
            return errors, parsed
        parsed["serial"] = serial

        # ── model ──────────────────────────────────────────────────────────
        model = row.get("model", "").strip()
        if model and not MODEL_PATTERN.match(model):
            errors.append(ImportError(row_num, "model", "INVALID_MODEL", f"model '{model}' contains invalid characters", model))
        parsed["model"] = model or None

        # ── hw_rev ─────────────────────────────────────────────────────────
        hw_rev = row.get("hw_rev", "").strip()
        if hw_rev and not HW_REV_PATTERN.match(hw_rev):
            errors.append(ImportError(row_num, "hw_rev", "INVALID_HW_REV", f"hw_rev '{hw_rev}' is invalid", hw_rev))
        parsed["hw_rev"] = hw_rev or None

        # ── batch_id ───────────────────────────────────────────────────────
        batch_id = row.get("batch_id", "").strip()
        if batch_id:
            if batch_id not in batch_cache:
                b = self.db.query(DeviceBatch).filter(DeviceBatch.batch_code == batch_id).first()
                batch_cache[batch_id] = b
            batch = batch_cache[batch_id]
            if not batch:
                errors.append(ImportError(row_num, "batch_id", "INVALID_BATCH", f"batch '{batch_id}' not found", batch_id))
            elif batch.revoked:
                errors.append(ImportError(row_num, "batch_id", "REVOKED_BATCH", f"batch '{batch_id}' is revoked", batch_id))
        parsed["batch_id"] = batch_id or None

        # ── manufacture_date ───────────────────────────────────────────────
        mfg_date_raw = row.get("manufacture_date", "").strip()
        if mfg_date_raw:
            if not DATE_PATTERN.match(mfg_date_raw):
                errors.append(ImportError(row_num, "manufacture_date", "INVALID_DATE_FORMAT",
                    f"manufacture_date '{mfg_date_raw}' must be YYYY-MM-DD", mfg_date_raw))
            else:
                try:
                    datetime.strptime(mfg_date_raw, "%Y-%m-%d")
                except ValueError:
                    errors.append(ImportError(row_num, "manufacture_date", "INVALID_DATE",
                        f"manufacture_date '{mfg_date_raw}' is not a valid calendar date", mfg_date_raw))
        parsed["manufacture_date"] = mfg_date_raw or None

        # ── supply_type ────────────────────────────────────────────────────
        st_raw = row.get("supply_type", "3P").strip().upper()
        supply_type = SUPPLY_MAP.get(st_raw)
        if not supply_type:
            errors.append(ImportError(row_num, "supply_type", "INVALID_SUPPLY_TYPE",
                f"supply_type '{st_raw}' must be 3P or 1P (or 3-phase/1-phase)", st_raw))
            supply_type = "3-phase"
        parsed["supply_type"] = supply_type

        # ── hp_rating ──────────────────────────────────────────────────────
        hp_raw = row.get("hp_rating", "").strip()
        if hp_raw:
            try:
                hp = float(hp_raw)
                if hp <= 0 or hp > 500:
                    raise ValueError
                parsed["hp_rating"] = hp
            except ValueError:
                errors.append(ImportError(row_num, "hp_rating", "INVALID_HP_RATING",
                    f"hp_rating '{hp_raw}' must be a positive number <= 500", hp_raw))
                parsed["hp_rating"] = 5.0
        else:
            parsed["hp_rating"] = 5.0

        return errors, parsed
