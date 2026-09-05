import uuid
from datetime import datetime, date
from sqlalchemy import (
    Column, String, Text, Boolean, Integer, SmallInteger, BigInteger,
    Numeric, DateTime, Date, ForeignKey, text
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.database import Base

SCHEMA = "agripump"

from app.models.user import User

class OtpChallenge(Base):
    __tablename__ = "otp_challenges"
    __table_args__ = {"schema": SCHEMA}

    phone_number = Column(String(20), primary_key=True)
    otp_code = Column(String(10), nullable=False)
    attempts = Column(Integer, default=0)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(64), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    replaced_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.refresh_tokens.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

class Pump(Base):
    __tablename__ = "pumps"
    __table_args__ = {"schema": SCHEMA}

    id = Column(String(50), primary_key=True)
    name = Column(String(100), nullable=False)
    supply_type = Column(String(10), default="3-phase")
    hp_rating = Column(Numeric(4, 1), default=7.5)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), nullable=True)
    installed_by_user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    hierarchy_path = Column(Text, nullable=False)
    latitude = Column(Numeric(10, 6), nullable=False, default=0.0)
    longitude = Column(Numeric(10, 6), nullable=False, default=0.0)
    firmware_version = Column(String(20), nullable=True)
    status = Column(String(20), default="STOPPED")
    lifecycle_state = Column(String(20), nullable=False, default="ACTIVE")
    device_key_hash = Column(String(255), nullable=True)
    last_command_at = Column(DateTime(timezone=True), nullable=True)
    last_seen_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    
    # Warranty & Panel bindings
    warranty_start_date = Column(Date, nullable=True)
    warranty_period_months = Column(Integer, nullable=True)
    panel_serial = Column(String(50), nullable=True)
    motor_rating = Column(String(50), nullable=True)
    starter_type = Column(String(30), nullable=True)
    pump_make = Column(String(50), nullable=True)
    pump_model = Column(String(50), nullable=True)

    owner = relationship("User", foreign_keys=[owner_user_id])
    config = relationship("DeviceConfig", uselist=False, back_populates="pump", cascade="all, delete-orphan")

class DeviceConfig(Base):
    __tablename__ = "device_config"
    __table_args__ = {"schema": SCHEMA}

    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE"), primary_key=True)
    desired_json = Column(JSONB, nullable=False, default={})
    reported_json = Column(JSONB, nullable=False, default={})
    status = Column(String(20), nullable=False, default="APPLIED")
    updated_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    pump = relationship("Pump", back_populates="config")

class Command(Base):
    __tablename__ = "commands"
    __table_args__ = {"schema": SCHEMA}

    cid = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE"), nullable=False)
    actor_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(10), nullable=False)
    status = Column(String(20), nullable=False, default="PENDING")
    reject_reason = Column(String(50), nullable=True)
    issued_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    acked_at = Column(DateTime(timezone=True), nullable=True)

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
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE"), nullable=False)
    v_ry = Column(Numeric(6, 2), nullable=True)
    v_yb = Column(Numeric(6, 2), nullable=True)
    v_br = Column(Numeric(6, 2), nullable=True)
    i_r = Column(Numeric(6, 2), nullable=True)
    i_y = Column(Numeric(6, 2), nullable=True)
    i_b = Column(Numeric(6, 2), nullable=True)
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

    code = Column(SmallInteger, primary_key=True)
    name = Column(String(50), nullable=False, unique=True)
    severity = Column(String(10), nullable=False)
    description = Column(Text, nullable=True)

class FaultLog(Base):
    __tablename__ = "fault_logs"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE"), nullable=False)
    fault_code = Column(SmallInteger, ForeignKey(f"{SCHEMA}.fault_code_catalog.code"), nullable=True)
    fault_description = Column(Text, nullable=True)
    v_ry = Column(Numeric(6, 2), nullable=True)
    v_yb = Column(Numeric(6, 2), nullable=True)
    v_br = Column(Numeric(6, 2), nullable=True)
    i_r = Column(Numeric(6, 2), nullable=True)
    i_y = Column(Numeric(6, 2), nullable=True)
    i_b = Column(Numeric(6, 2), nullable=True)
    occurred_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    ack_by_user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id"), nullable=True)
    ack_at = Column(DateTime(timezone=True), nullable=True)

class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE"), nullable=False)
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
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE"), nullable=True)
    alert_type = Column(String(20), nullable=True)
    min_severity = Column(String(10), nullable=True)
    muted = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

class AllocationLog(Base):
    __tablename__ = "allocation_log"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE"), nullable=False)
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
    desired_json = Column(JSONB, nullable=True, default={})
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id"), nullable=True)
    owner_hierarchy_path = Column(Text, nullable=True)
    hp_rating = Column(Numeric(4, 1), nullable=True)
    supply_type = Column(String(20), default="3-phase")
    config_json = Column(JSONB, nullable=True, default={})
    created_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow)

class Panel(Base):
    __tablename__ = "panels"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    panel_serial = Column(String(100), nullable=False, unique=True)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="SET NULL"), nullable=True)
    motor_hp = Column(Numeric(4, 1), nullable=True)
    starter_type = Column(String(50), nullable=True)
    ct_ratio = Column(Integer, nullable=True)
    make_model = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

class Branding(Base):
    __tablename__ = "branding"
    __table_args__ = {"schema": SCHEMA}

    org_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), primary_key=True)
    theme_color = Column(String(20), nullable=True)
    logo_url = Column(Text, nullable=True)
    sender_name = Column(String(50), nullable=True)
    subdomain = Column(String(50), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

class Invite(Base):
    __tablename__ = "invites"
    __table_args__ = {"schema": SCHEMA}

    token = Column(String(64), primary_key=True)
    parent_user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False)
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
    quantity = Column(Integer, default=0)
    manufacture_date = Column(Date, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    revoked = Column(Boolean, default=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)

class BatchImei(Base):
    __tablename__ = "batch_imeis"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    batch_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.device_batches.id", ondelete="CASCADE"), nullable=False)
    imei = Column(String(20), nullable=False, unique=True)
    mcu_uid = Column(String(30), nullable=True)
    claimed = Column(Boolean, default=False)
    claimed_at = Column(DateTime(timezone=True), nullable=True)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
