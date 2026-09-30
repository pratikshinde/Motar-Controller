import uuid
from datetime import datetime, date
from sqlalchemy import (
    Column, String, Text, Boolean, Integer, SmallInteger, BigInteger,
    Numeric, DateTime, Date, ForeignKey, Index, UniqueConstraint, CheckConstraint, text
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.database import Base

SCHEMA = "agripump"

from app.models.types import LTree
from app.models.organisation import Organisation
from app.models.site import Site
from app.models.device_access import DeviceAccess
from app.models.user import User

class OtpChallenge(Base):
    """An OTP in flight: today only `purpose='login'` (every phone-based sign-in), soon also `registration`
    (prove a new phone before the account behind it is created) and `password_reset` (prove a partner still
    holds their phone before letting them set a new password) — same hardening for all three: the code lives
    only as `code_hash` (sha256, compared in constant time, never logged), a wrong guess increments `attempts`,
    and a fresh send for the same (phone, purpose) replaces whatever was pending, never adds a second row.
    `channel` records how the code was actually delivered ('sms' | 'whatsapp') for audit and rate-limiting;
    it does not change how the row is validated.
    """
    __tablename__ = "otp_challenges"
    __table_args__ = (
        # At most one *unconsumed* challenge per (phone, purpose) at a time - the DB-level version of the
        # app's "look one up, overwrite it, else insert" upsert, now that phone_number alone can no longer
        # be the primary key (a phone can have a pending login challenge and a pending registration
        # challenge at once).
        Index("uq_otp_challenges_active", "phone_number", "purpose", unique=True,
              postgresql_where=text("consumed_at IS NULL")),
        CheckConstraint("purpose IN ('login', 'registration', 'password_reset')", name="otp_challenges_purpose_check"),
        CheckConstraint("channel IN ('sms', 'whatsapp')", name="otp_challenges_channel_check"),
        {"schema": SCHEMA},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone_number = Column(String(20), nullable=False, index=True)
    purpose = Column(String(20), nullable=False, default="login")
    channel = Column(String(10), nullable=False, default="sms")
    code_hash = Column(String(64), nullable=False)
    attempts = Column(Integer, default=0)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    # Set the instant a correct code is accepted, so the same code cannot be replayed - and, for
    # registration/password_reset, so a second PhoneVerification ticket can't be minted from one answer.
    consumed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class PhoneVerification(Base):
    """A one-time proof of phone ownership, spent to finish the sensitive action it was requested for.

    Answering an OTP correctly and *acting* on that (creating the account, resetting the password) are kept
    as two separate, auditable steps - mirrors InviteToken's shape. Only the ticket's hash is stored; the raw
    value is handed to the client once, exactly like a refresh token, and is single-use and short-lived
    (the route that issues it sets `expires_at`; a few minutes, not hours).
    """
    __tablename__ = "phone_verifications"
    __table_args__ = (
        CheckConstraint("purpose IN ('registration', 'password_reset')", name="phone_verifications_purpose_check"),
        {"schema": SCHEMA},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone_number = Column(String(20), nullable=False, index=True)
    purpose = Column(String(20), nullable=False)
    token_hash = Column(String(64), unique=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    consumed_at = Column(DateTime(timezone=True), nullable=True)

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    family_id = Column(UUID(as_uuid=True), default=uuid.uuid4, nullable=False, index=True)
    token_hash = Column(String(64), nullable=False)
    app_install_id = Column(String(100), nullable=True)
    device_info = Column(String(255), nullable=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    replaced_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.refresh_tokens.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

class Pump(Base):
    __tablename__ = "pumps"
    __table_args__ = (
        # A panel serial names one physical panel. Checked by the database, not by a query, because a partner's
        # queries only see their own pumps and must not learn (or miss) what sits in another partner's tree.
        Index("uq_pumps_panel_serial", "panel_serial", unique=True, postgresql_where=text("panel_serial IS NOT NULL")),
        {"schema": SCHEMA},
    )

    id = Column(String(50), primary_key=True)
    name = Column(String(100), nullable=False)
    supply_type = Column(String(10), nullable=False, default="3-phase")
    hp_rating = Column(Numeric(4, 1), default=7.5)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    installed_by_user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    org_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.organisations.id", ondelete="SET NULL"), nullable=True)
    hierarchy_path = Column(Text, nullable=False)
    # NULL = position not known (never a placeholder 0, 0)
    latitude = Column(Numeric(10, 6), nullable=True)
    longitude = Column(Numeric(10, 6), nullable=True)
    firmware_version = Column(String(20), nullable=True)
    status = Column(String(20), default="STOPPED")
    lifecycle_state = Column(String(20), nullable=False, default="ACTIVE")
    device_key_hash = Column(String(255), nullable=True)
    last_command_at = Column(DateTime(timezone=True), nullable=True)
    # NULL until the device has actually reported: creating the row is not seeing the pump
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    
    # Warranty & Panel bindings
    warranty_start_date = Column(Date, nullable=True)
    warranty_period_months = Column(Integer, nullable=True)
    panel_serial = Column(String(50), nullable=True)
    motor_rating = Column(String(50), nullable=True)
    starter_type = Column(String(30), nullable=True)
    pump_make = Column(String(50), nullable=True)
    pump_model = Column(String(50), nullable=True)

    # Reported by the device (`rt`) / set by billing tooling
    total_runtime_min = Column(BigInteger, nullable=True)
    subscription_expires_at = Column(DateTime(timezone=True), nullable=True)
    # True once this device has answered a command with an ack carrying the command's `cid` (firmware F2);
    # from then on "applied" is never inferred from telemetry for it.
    supports_command_ack = Column(Boolean, nullable=False, default=False, server_default=text("false"))

    owner = relationship("User", foreign_keys=[owner_user_id])
    organisation = relationship("Organisation", foreign_keys=[org_id])
    config = relationship("DeviceConfig", uselist=False, back_populates="pump", cascade="all, delete-orphan")

class DeviceConfig(Base):
    __tablename__ = "device_config"
    __table_args__ = {"schema": SCHEMA}

    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), primary_key=True)
    desired_json = Column(JSONB, nullable=False, default={})
    reported_json = Column(JSONB, nullable=False, default={})
    status = Column(String(20), nullable=False, default="APPLIED")
    updated_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    pump = relationship("Pump", back_populates="config")

class Command(Base):
    __tablename__ = "commands"
    __table_args__ = {"schema": SCHEMA}

    cid = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    actor_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(30), nullable=False)
    # QUEUED -> SENT -> DELIVERED -> ACKNOWLEDGED -> APPLIED, or REJECTED / EXPIRED / FAILED / NOT_CONFIRMED.
    # Transitions go through app.services.command_service.transition; do not assign `status` directly.
    status = Column(String(20), nullable=False, default="QUEUED")
    reject_reason = Column(String(50), nullable=True)
    failure_reason = Column(String(50), nullable=True)
    payload = Column(JSONB, nullable=True)
    idempotency_key = Column(String(100), nullable=True)
    issued_at = Column(DateTime(timezone=True), default=datetime.utcnow)  # queued_at
    sent_at = Column(DateTime(timezone=True), nullable=True)
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    acked_at = Column(DateTime(timezone=True), nullable=True)
    applied_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)

    @property
    def command(self) -> str:
        return self.action

    @property
    def created_at(self):
        return self.issued_at

class TelemetryHistory(Base):
    __tablename__ = "telemetry_history"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    v_ry = Column(Numeric(5, 1), nullable=True)
    v_yb = Column(Numeric(5, 1), nullable=True)
    v_br = Column(Numeric(5, 1), nullable=True)
    i_r = Column(Numeric(5, 2), nullable=True)
    i_y = Column(Numeric(5, 2), nullable=True)
    i_b = Column(Numeric(5, 2), nullable=True)
    pump_on = Column(Boolean, default=False)
    fault_active = Column(Boolean, default=False)
    gsm_rssi = Column(Integer, nullable=True)
    seq = Column(BigInteger, nullable=True)
    ts_approx = Column(Boolean, default=False)
    buffered = Column(Boolean, default=False)
    recorded_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

class FaultCodeCatalog(Base):
    __tablename__ = "fault_code_catalog"
    __table_args__ = {"schema": SCHEMA}

    code = Column(SmallInteger, primary_key=True, autoincrement=False)
    name = Column(String(50), nullable=False, unique=True)
    severity = Column(String(10), nullable=False)
    description = Column(Text, nullable=False)

class FaultLog(Base):
    __tablename__ = "fault_logs"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    occurred_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    fault_code = Column(SmallInteger, ForeignKey(f"{SCHEMA}.fault_code_catalog.code"), nullable=True)
    description = Column(Text, nullable=False)
    fault_description = Column(Text, nullable=True)
    v_yb_snapshot = Column(Numeric(5, 1), nullable=True)
    contactor_tripped = Column(Boolean, default=True)
    alert_sent_sms = Column(Boolean, default=False)
    alert_sent_whatsapp = Column(Boolean, default=False)
    fault_code_legacy_text = Column(String(30), nullable=True)
    v_ry = Column(Numeric(6, 2), nullable=True)
    v_yb = Column(Numeric(6, 2), nullable=True)
    v_br = Column(Numeric(6, 2), nullable=True)
    i_r = Column(Numeric(6, 2), nullable=True)
    i_y = Column(Numeric(6, 2), nullable=True)
    i_b = Column(Numeric(6, 2), nullable=True)
    ack_by_user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    ack_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)

class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    alert_type = Column(String(20), nullable=False)
    severity = Column(String(10), nullable=False)
    fault_code = Column(SmallInteger, ForeignKey(f"{SCHEMA}.fault_code_catalog.code"), nullable=True)
    source_fault_log_id = Column(BigInteger, ForeignKey(f"{SCHEMA}.fault_logs.id", ondelete="SET NULL"), nullable=True)
    dedup_bucket = Column(BigInteger, nullable=False)
    occurrence_count = Column(Integer, nullable=False, default=1)
    first_occurred_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    last_occurred_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    acknowledged_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    assigned_to = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolution_note = Column(Text, nullable=True)

class AlertSubscription(Base):
    __tablename__ = "alert_subscriptions"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=True)
    alert_type = Column(String(20), nullable=True)
    min_severity = Column(String(10), nullable=True)
    muted = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

class AllocationLog(Base):
    __tablename__ = "allocation_log"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    from_user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    to_user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    actor_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    note = Column(Text, nullable=True)
    occurred_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    @property
    def actor_user_id(self):
        return self.actor_id

class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    actor_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    actor_role = Column(String(30), nullable=True)
    entity_type = Column(String(30), nullable=False)
    entity_id = Column(String(50), nullable=False)
    action = Column(String(30), nullable=False)
    before_json = Column(JSONB, nullable=True)
    after_json = Column(JSONB, nullable=True)
    ip = Column(String(45), nullable=True)
    occurred_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    @property
    def actor_user_id(self):
        return self.actor_id

class ConfigTemplate(Base):
    __tablename__ = "config_templates"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    desired_json = Column(JSONB, nullable=False, default={})
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    owner_hierarchy_path = Column(Text, nullable=False)
    hp_rating = Column(Numeric(4, 1), nullable=True)
    supply_type = Column(String(20), default="3-phase")
    config_json = Column(JSONB, nullable=True, default={})
    created_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow)

class Panel(Base):
    __tablename__ = "panels"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    panel_serial = Column(String(100), nullable=False, unique=True)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="SET NULL", onupdate="CASCADE"), nullable=True)
    motor_hp = Column(Numeric(4, 1), nullable=True)
    starter_type = Column(String(50), nullable=True)
    ct_ratio = Column(Integer, nullable=True)
    make_model = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

class Branding(Base):
    __tablename__ = "branding"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), default=uuid.uuid4, unique=True)
    org_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), primary_key=True)
    theme_color = Column(String(7), nullable=True)
    logo_url = Column(Text, nullable=True)
    sender_name = Column(String(50), nullable=True)
    subdomain = Column(String(63), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

class Invite(Base):
    __tablename__ = "invites"
    __table_args__ = {"schema": SCHEMA}

    token = Column(String(64), primary_key=True)
    parent_user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    invited_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    phone = Column(String(20), nullable=True)
    device_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=True)
    role = Column(String(20), nullable=False, default="viewer")
    status = Column(String(20), nullable=False, default="PENDING")
    dealer_depth = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    redeemed_at = Column(DateTime(timezone=True), nullable=True)

class DeviceBatch(Base):
    __tablename__ = "device_batches"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_code = Column(String(50), nullable=False, unique=True)
    model = Column(String(100), nullable=False)
    hw_rev = Column(String(20), nullable=True)
    quantity = Column(Integer, nullable=False, default=0)
    manufacture_date = Column(Date, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    revoked = Column(Boolean, nullable=False, default=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)

class BatchImei(Base):
    __tablename__ = "batch_imeis"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    batch_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.device_batches.id", ondelete="CASCADE"), nullable=False)
    imei = Column(String(20), nullable=False, unique=True)
    mcu_uid = Column(String(30), nullable=True)
    claimed = Column(Boolean, nullable=False, default=False)
    claimed_at = Column(DateTime(timezone=True), nullable=True)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="SET NULL", onupdate="CASCADE"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class DailySummary(Base):
    """
    Per-device per-day rollup compacted by the nightly jobs worker (P2.3).

    Columns:
      - runtime_min   : total minutes motor was ON during the day
      - start_count   : number of discrete START events
      - fault_count   : number of fault records
      - offline_min   : estimated minutes the device was offline (gap analysis)
      - v_min/max/mean: voltage stats across all samples (average of 3 phases)
      - i_min/max/mean: current stats across all samples (average of 3 phases)
      - sample_count  : raw telemetry rows that fed into this summary

    SRS: FR-CLD-025, NFR-D-001/002, NFR-S-003
    """
    __tablename__ = "daily_summary"
    __table_args__ = (UniqueConstraint("device_id", "day", name="daily_summary_device_day_uniq"), {"schema": SCHEMA})

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    device_id = Column(
        String(50),
        ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
    )
    day = Column(Date, nullable=False)

    # Operational metrics
    runtime_min = Column(Integer, nullable=False, default=0)
    start_count = Column(Integer, nullable=False, default=0)
    fault_count = Column(Integer, nullable=False, default=0)
    offline_min = Column(Integer, nullable=False, default=0)

    # Voltage stats
    v_min = Column(Numeric(6, 2), nullable=True)
    v_max = Column(Numeric(6, 2), nullable=True)
    v_mean = Column(Numeric(6, 2), nullable=True)

    # Current stats
    i_min = Column(Numeric(6, 2), nullable=True)
    i_max = Column(Numeric(6, 2), nullable=True)
    i_mean = Column(Numeric(6, 2), nullable=True)

    sample_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class DashboardRuntime(Base):
    """
    Minutes each device's motor has run, kept current by the dashboard refresher (every few minutes) so a dashboard
    never has to scan raw telemetry or sum per-device daily rollups on each refresh.

      - runtime_min  : minutes run today (a calendar day in the dashboard timezone, `day`)
      - history_min  : minutes run over the completed days before today, inside the dashboard window
      - history_days : the window (today + N-1 completed days) those figures were computed for

    A row whose `day` is not today's date, or whose `history_days` differs from the configured window, is stale and
    ignored. The nightly `daily_summary` rollup remains the source of truth for finished days. One row per device.
    """
    __tablename__ = "dashboard_runtime"
    __table_args__ = {"schema": SCHEMA}

    device_id = Column(
        String(50),
        ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
    )
    day = Column(Date, nullable=False)
    runtime_min = Column(Integer, nullable=False, server_default="0")
    history_min = Column(Integer, nullable=False, server_default="0")
    history_days = Column(SmallInteger, nullable=False, server_default="0")
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class AccountDeletionRequest(Base):
    """A farmer's "delete my data" request. Handled by staff; legal-retention records are kept."""
    __tablename__ = "account_deletion_requests"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    requested_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    status = Column(String(20), nullable=False, default="PENDING")
    reason = Column(Text, nullable=True)
    handled_at = Column(DateTime(timezone=True), nullable=True)
    handled_by = Column(UUID(as_uuid=True), nullable=True)


class InviteToken(Base):
    """An onboarding link for a new user/organisation (Phase 2C). Only the hash of the token is stored."""
    __tablename__ = "invite_tokens"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_hash = Column(String(255), unique=True, nullable=False)
    role = Column(String(20), nullable=False)
    target_role = Column(String(30), nullable=True)
    phone = Column(String(20), nullable=True, index=True)
    target_org_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.organisations.id", ondelete="CASCADE"), nullable=True, index=True)
    parent_user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), nullable=True)
    parent_hierarchy_path = Column(Text, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(20), nullable=False, default="PENDING", index=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    used_by_user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)

    target_organisation = relationship("Organisation", foreign_keys=[target_org_id])
    inviter = relationship("User", foreign_keys=[created_by])

OrganisationInvitation = InviteToken


class BridgeSwapLog(Base):
    """Whole-device replacement (RMA / warranty swap): the record that the identity moved from one pump to another."""
    __tablename__ = "bridge_swap_log"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    old_pump_id = Column(String(50), nullable=False)
    new_pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    reason = Column(Text, nullable=True)
    performed_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    occurred_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class McuSwapLog(Base):
    """Routine controller (MCU) replacement inside a device: history only, the device's identity does not change."""
    __tablename__ = "mcu_swap_log"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    old_mcu_uid = Column(String(30), nullable=True)
    new_mcu_uid = Column(String(30), nullable=False)
    reason = Column(Text, nullable=True)
    performed_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    occurred_at = Column(DateTime(timezone=True), default=datetime.utcnow)
