"""The factory's starter sheet: one Excel (or CSV) file per batch, one row per starter.

Columns (names are matched loosely: "Starter ID", "starter_id", "Barcode" and "Serial" all mean the same):

    Starter ID    required   the barcode on the starter's box. It is also the module's own id, the AWS thing name and the pump id, so letters, digits and : _ -
                              only, at most 30 characters
    IMEI          optional   the modem's IMEI (14 to 17 digits)
    HP            optional   the pump's capacity, for example 7.5
    Supply        optional   3-phase or 1-phase (3P, 1P and 3 are understood)
    Model, HW revision, Manufacture date, Notes   optional

The sheet is checked as a whole and either every row is accepted or none is (the caller saves nothing when there is an error), so a half-uploaded batch never
exists. Nothing in a cell is ever run: files are only read (formulas are not evaluated; macro files are refused).
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 5000
STARTER_ID = re.compile(r"^[A-Za-z0-9:_-]{1,30}$")          # batch_imeis.mcu_uid is 30 characters

_ALIASES = {
    "starter_id": {"starter_id", "starter", "starter_no", "starter_number", "barcode", "bar_code", "serial", "serial_number", "serial_no", "id", "device_id", "dev_id", "mcu_uid", "mcu_id", "uid"},
    "imei": {"imei", "modem_imei", "imei_number", "imei_no"},
    "hp_rating": {"hp", "hp_rating", "horsepower", "capacity", "capacity_hp", "rating", "pump_hp"},
    "supply_type": {"supply", "supply_type", "phase", "phases"},
    "model": {"model", "model_no", "model_number"},
    "hw_rev": {"hw_rev", "hw_revision", "hardware", "hardware_rev", "hardware_revision", "revision", "hw"},
    "manufacture_date": {"manufacture_date", "manufacturing_date", "manufactured", "manufactured_on", "mfg_date", "date"},
    "notes": {"notes", "note", "remarks", "remark", "comment", "comments"},
}
_LOOKUP = {alias: field_name for field_name, aliases in _ALIASES.items() for alias in aliases}
TEMPLATE_HEADERS = ["Starter ID", "IMEI", "HP", "Supply", "Model", "HW revision", "Manufacture date", "Notes"]


class SheetError(Exception):
    """The file itself cannot be read (wrong type, too big, not a spreadsheet, no Starter ID column)."""


@dataclass
class StarterRow:
    row: int                      # the row number in the sheet (the header is row 1)
    starter_id: str
    imei: Optional[str] = None
    hp_rating: Optional[float] = None
    supply_type: Optional[str] = None
    model: Optional[str] = None
    hw_rev: Optional[str] = None
    manufacture_date: Optional[date] = None
    notes: Optional[str] = None


@dataclass
class SheetResult:
    rows: List[StarterRow] = field(default_factory=list)
    errors: List[Dict[str, Any]] = field(default_factory=list)


def _key(header: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(header or "").strip().lower()).strip("_")


def _text(value: Any) -> str:
    """A cell as text. Excel stores 861234567890123 as a number, which must not turn into '8.61234567890123e+14' or '861234567890123.0'."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value).strip()


def _supply(value: str) -> Optional[str]:
    v = re.sub(r"[^a-z0-9]", "", value.lower())
    if v in ("3", "3p", "3ph", "3phase", "threephase", "three"):
        return "3-phase"
    if v in ("1", "1p", "1ph", "1phase", "singlephase", "single", "onephase"):
        return "1-phase"
    return None


def _date(value: Any) -> Optional[date]:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = _text(value)
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"'{text}' is not a date (use 2026-11-30 or 30-11-2026)")


def _read_table(filename: str, content: bytes) -> List[List[Any]]:
    name = (filename or "").lower()
    if len(content) > MAX_BYTES:
        raise SheetError(f"The file is larger than {MAX_BYTES // (1024 * 1024)} MB.")
    if name.endswith(".xlsm") or name.endswith(".xls"):
        raise SheetError("Save the sheet as an Excel Workbook (.xlsx) or a .csv file; macro and old .xls files are not accepted.")
    if name.endswith(".xlsx"):
        try:
            from openpyxl import load_workbook
            wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        except Exception:
            raise SheetError("That is not a readable Excel (.xlsx) file.")
        ws = wb.worksheets[0]
        rows: List[List[Any]] = []
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            if i > MAX_ROWS + 5:
                raise SheetError(f"More than {MAX_ROWS} rows. Upload the batch in parts.")
            rows.append(list(row))
        wb.close()
        return rows
    if name.endswith(".csv"):
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
        try:
            dialect = csv.Sniffer().sniff(text[:2048], delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        rows = []
        for i, row in enumerate(csv.reader(io.StringIO(text), dialect)):
            if i > MAX_ROWS + 5:
                raise SheetError(f"More than {MAX_ROWS} rows. Upload the batch in parts.")
            rows.append(row)
        return rows
    raise SheetError("Upload an Excel (.xlsx) or .csv file.")


def parse_sheet(filename: str, content: bytes) -> SheetResult:
    # Row numbers are the sheet's own (the header is row 1), counted over every row as the user sees it, blank ones included.
    table = [(n, r) for n, r in enumerate(_read_table(filename, content), start=1) if any(_text(c) for c in r)]
    if not table:
        raise SheetError("The sheet is empty.")
    header = table[0][1]
    columns: Dict[str, int] = {}
    for idx, h in enumerate(header):
        target = _LOOKUP.get(_key(h))
        if target and target not in columns:
            columns[target] = idx
    if "starter_id" not in columns:
        raise SheetError("The first row must name the columns, and one of them must be 'Starter ID' (or Barcode / Serial).")
    body = table[1:]
    if len(body) > MAX_ROWS:
        raise SheetError(f"More than {MAX_ROWS} rows. Upload the batch in parts.")

    result = SheetResult()
    seen_ids: Dict[str, int] = {}
    seen_imeis: Dict[str, int] = {}

    def cell(row, name):
        idx = columns.get(name)
        return row[idx] if idx is not None and idx < len(row) else None

    for number, row in body:
        def fail(starter, reason):
            result.errors.append({"row": number, "starter_id": starter, "reason": reason})

        sid = _text(cell(row, "starter_id"))
        if not sid:
            fail("", "no Starter ID")
            continue
        if not STARTER_ID.match(sid):
            fail(sid, "the Starter ID may only have letters, digits and : _ - (at most 30 characters)")
            continue
        if sid in seen_ids:
            fail(sid, f"the same Starter ID is already in row {seen_ids[sid]}")
            continue
        seen_ids[sid] = number

        item = StarterRow(row=number, starter_id=sid)
        problem = None

        imei = re.sub(r"\s+", "", _text(cell(row, "imei")))
        if imei:
            if not imei.isdigit() or not 14 <= len(imei) <= 17:
                problem = f"IMEI '{imei}' must be 14 to 17 digits"
            elif imei in seen_imeis:
                problem = f"the same IMEI is already in row {seen_imeis[imei]}"
            else:
                item.imei = imei
                seen_imeis[imei] = number

        hp_text = _text(cell(row, "hp_rating"))
        if not problem and hp_text:
            m = re.search(r"\d+(?:[.,]\d+)?", hp_text)
            hp = float(m.group(0).replace(",", ".")) if m else None
            if hp is None or not 0.1 <= hp <= 100:
                problem = f"HP '{hp_text}' must be a number between 0.1 and 100"
            else:
                item.hp_rating = round(hp, 1)

        supply_text = _text(cell(row, "supply_type"))
        if not problem and supply_text:
            item.supply_type = _supply(supply_text)
            if item.supply_type is None:
                problem = f"Supply '{supply_text}' must be 3-phase or 1-phase"

        if not problem and _text(cell(row, "manufacture_date")):
            try:
                item.manufacture_date = _date(cell(row, "manufacture_date"))
            except ValueError as exc:
                problem = str(exc)

        if problem:
            fail(sid, problem)
            continue
        item.model = _text(cell(row, "model"))[:100] or None
        item.hw_rev = _text(cell(row, "hw_rev"))[:20] or None
        item.notes = _text(cell(row, "notes")) or None
        result.rows.append(item)
    return result


def template_xlsx() -> bytes:
    """An empty sheet with the column names, for the factory to fill in."""
    from openpyxl import Workbook
    from openpyxl.styles import Font
    wb = Workbook()
    ws = wb.active
    ws.title = "Starters"
    ws.append(TEMPLATE_HEADERS)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    ws.append(["EXAMPLE-0001", "861234567890123", 7.5, "3-phase", "PCD-A7672S", "1.0", "2026-11-30", "Example row: delete it before uploading"])
    ws.append(["EXAMPLE-0002", "", 5, "3-phase", "PCD-A7672S", "1.0", "2026-11-30", "Example row: delete it before uploading"])
    for col, width in zip("ABCDEFGH", (20, 20, 8, 12, 16, 14, 18, 42)):
        ws.column_dimensions[col].width = width
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
