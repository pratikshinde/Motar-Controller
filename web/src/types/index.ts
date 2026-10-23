// Types mirror the actual API response shapes in backend/server.js —
// not a demo/aspirational model. Fields are optional where the backend
// can genuinely return null (e.g. a pump with no telemetry yet).

export type RoleTier = 'superadmin' | 'manufacturer' | 'distributor' | 'dealer' | 'customer' | 'support';

export type LifecycleState =
  | 'MANUFACTURED' | 'ALLOCATED' | 'IN_STOCK' | 'COMMISSIONED'
  | 'ACTIVE' | 'SUSPENDED' | 'RMA' | 'RETIRED';

export type PumpStatus = 'RUNNING' | 'STOPPED' | 'FAULT';

export type OrgRole = 'owner' | 'staff' | 'readonly';
export type AccountStatus = 'ACTIVE' | 'SUSPENDED';

export interface User {
  id: string;
  full_name: string;
  phone_number: string;
  role: RoleTier;
  hierarchy_path: string;
  dealer_depth?: number;
  totp_enabled?: boolean;
  // P-1 — multi-staff accounts (Web_App_Pending_Items.md §8.1.2)
  org_node_id?: string | null;
  org_role?: OrgRole;
  // FR-WEB-012
  account_status?: AccountStatus;
  contract_notes?: string | null;
  device_quota?: number | null;
}

// GET /api/users/tree groups every login sharing one org unit under
// `members`; `children` branches only at the org-unit level, not per login.
export interface UserTreeNode extends User {
  parent_user_id: string | null;
  members: User[];
  children: UserTreeNode[];
}

export type DeviceType = 'AC_3PH' | 'SOLAR_VFD';

export interface VfdTelemetry {
  hz?: number | null;
  i_out?: number | null;
  v_ac?: number | null;
  v_dc?: number | null;
  kw?: number | null;
  status?: string | null;
  fault_code?: number | null;
}

// GET /api/pumps row shape, after the W0 LATERAL join onto latest telemetry.
export interface PumpListItem {
  id: string;
  name: string;
  device_type?: DeviceType;
  supply_type: '3-phase' | '1-phase';
  hp_rating: string | number;
  latitude: string | number | null;
  longitude: string | number | null;
  status: PumpStatus;
  /** ONLINE, OFFLINE (reported before, not recently) or NEVER_SEEN: judged by the server. */
  connectivity?: 'ONLINE' | 'OFFLINE' | 'NEVER_SEEN';
  total_runtime_min?: number | null;
  lifecycle_state: LifecycleState;
  firmware_version: string | null;
  last_seen_at: string | null;

  // Latest telemetry, LEFT JOINed — all null until the device (or
  // simulator) has actually reported. Never render these as a fabricated
  // fallback value (Web_App_Pending_Items.md W0).
  v_ry: string | null;
  v_yb: string | null;
  v_br: string | null;
  i_r: string | null;
  i_y: string | null;
  i_b: string | null;
  gsm_rssi: number | null;
  telemetry_recorded_at: string | null;
  ts_approx: boolean | null;
  buffered: boolean | null;

  // SOLAR_VFD telemetry fields
  vfd_hz?: string | number | null;
  vfd_i_out?: string | number | null;
  vfd_v_ac?: string | number | null;
  vfd_v_dc?: string | number | null;
  vfd_kw?: string | number | null;
  vfd_status?: string | null;
  vfd_fault_code?: number | null;
  vfd?: VfdTelemetry | null;
}

/** Exclusive counts over every pump in scope: a pump is in exactly one of offline, no_data, fault, running, stopped. */
export interface FleetStats {
  total: number;
  running: number;
  fault: number;
  stopped: number;
  offline: number;
  no_data: number;
}

export interface PumpsResponse {
  meta: { page: number; limit: number; total?: number; stats: FleetStats };
  pumps: PumpListItem[];
}

export interface FaultLogEntry {
  id: number;
  pump_id: string;
  occurred_at: string;
  fault_code: number;
  fault_name: string | null;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | null;
  description: string;
  v_yb_snapshot: string | null;
  contactor_tripped: boolean;
  alert_sent_sms: boolean;
  alert_sent_whatsapp: boolean;
  ack_by_user_id: string | null;
  ack_at: string | null;
  resolved_at: string | null;
}

// GET /api/alerts, GET/POST /api/alert-subscriptions — FR-WEB-060/062/063,
// scoped down (17 Aug 2026) to in-app-only delivery over the WebSocket hub
// while a user is connected; see backend/services/alertEngine.js. Distinct
// from FaultLogEntry: fault_logs is device/panel-reset state, alerts is
// the human support-workflow layer (ack/assign/resolve) and also covers
// OFFLINE, which has no fault_logs row at all.
export type AlertType = 'FAULT' | 'OFFLINE';
export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface AlertRow {
  id: string;
  pump_id: string;
  pump_name: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  fault_code: number | null;
  fault_name: string | null;
  source_fault_log_id: string | null;
  occurrence_count: number;
  first_occurred_at: string;
  last_occurred_at: string;
  acknowledged_by: string | null;
  acknowledged_by_name: string | null;
  acknowledged_at: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

// pump_id/alert_type/min_severity NULL = "every device in my scope" /
// "every type" / "every severity" — a row only narrows or mutes, it never
// opts in (default with zero rows is subscribed to everything).
export interface AlertSubscription {
  id: string;
  user_id: string;
  pump_id: string | null;
  alert_type: AlertType | null;
  min_severity: AlertSeverity | null;
  muted: boolean;
  created_at: string;
}

export interface CommandRecord {
  cid: string;
  pump_id: string;
  action: 'START' | 'STOP' | 'SET_TIMER' | 'RESET_FAULT';
  /** QUEUED -> SENT -> DELIVERED -> ACKNOWLEDGED -> APPLIED, or one of the endings below. */
  status:
    | 'QUEUED'
    | 'SENT'
    | 'DELIVERED'
    | 'ACKNOWLEDGED'
    | 'APPLIED'
    | 'REJECTED'
    | 'EXPIRED'
    | 'FAILED'
    | 'NOT_CONFIRMED';
  reject_reason?: string | null;
  failure_reason?: string | null;
  issued_at: string;
  sent_at?: string | null;
  delivered_at?: string | null;
  acked_at?: string | null;
  applied_at?: string | null;
  expires_at: string;
}

// GET /api/pumps/:id
export interface TelemetryRow {
  id?: number;
  pump_id?: string;
  recorded_at: string;
  device_type?: DeviceType;
  v_ry: string | null;
  v_yb: string | null;
  v_br: string | null;
  i_r: string | null;
  i_y: string | null;
  i_b: string | null;
  gsm_rssi: number | null;
  pump_on: boolean;
  fault_active: boolean;
  seq: number | null;
  ts_approx: boolean;
  buffered: boolean;
  // SOLAR_VFD telemetry fields
  vfd_hz?: string | number | null;
  vfd_i_out?: string | number | null;
  vfd_v_ac?: string | number | null;
  vfd_v_dc?: string | number | null;
  vfd_kw?: string | number | null;
  vfd_status?: string | null;
  vfd_fault_code?: number | null;
  vfd?: VfdTelemetry | null;
}

// FR-WEB-031 panel binding — direct columns on `pumps` (see schema.sql
// §"panel binding"), settable via PUT /api/pumps/:id/panel by superadmin
// through dealer (install-time fields, not customer-editable).
export interface PanelBinding {
  panel_serial: string | null;
  motor_rating: string | null;
  starter_type: string | null;
  pump_make: string | null;
  pump_model: string | null;
}

export interface PumpDetail {
  pump: PumpListItem &
    PanelBinding & {
      owner_user_id?: string;
      hierarchy_path?: string;
      device_key_hash?: never;
      created_at?: string;
      warranty_start_date?: string | null;
      warranty_period_months?: number | null;
    };
  latest_telemetry: TelemetryRow | null;
  config: DeviceConfig | null;
  open_fault_count: number;
}

// GET /api/pumps/:id/provenance — §8.4 Ownership/Diagnostics tabs. `batch`
// is null whenever the device wasn't claimed from a tracked manufacturing
// batch (e.g. hand-created pumps) — never a fabricated "unknown" row.
export interface AllocationHistoryEntry {
  id: string;
  occurred_at: string;
  note: string | null;
  from_user_id: string | null;
  from_full_name: string | null;
  to_user_id: string;
  to_full_name: string;
  actor_id: string | null;
  actor_full_name: string | null;
}

export interface WarrantyInfo {
  start_date: string;
  period_months: number;
  end_date: string;
  expired: boolean;
}

export interface PumpBatchOrigin {
  imei: string;
  mcu_uid: string | null;
  claimed_at: string | null;
  batch_code: string;
  model: string;
  hw_rev: string | null;
}

export interface PumpProvenance {
  owner: { id: string; full_name: string; phone_number: string; role: RoleTier } | null;
  allocation_history: AllocationHistoryEntry[];
  warranty: WarrantyInfo | null;
  batch: PumpBatchOrigin | null;
}

// device_config — desired vs reported, SRS §6.4. Values are the layer-A
// settings keys (§6.1), stored as JSONB so shape is not statically fixed.
export interface DeviceConfig {
  pump_id: string;
  desired_json: Record<string, number | boolean>;
  reported_json: Record<string, number | boolean>;
  status: 'PENDING' | 'APPLIED' | 'FAILED';
  updated_by?: string | null;
  updated_at?: string;
}

// GET /api/service-reports, GET /api/pumps/:id/service-report (FR-WEB-037).
// mtbf_hours is null (not Infinity) when fault_count is 0 for the window —
// insufficient data, not a fabricated "perfect" number.
export interface ServiceReportRow {
  id: string;
  name: string;
  fault_count: string;
  runtime_hours: string;
  mtbf_hours: string | null;
  uptime_pct: string;
}

export interface ServiceReportsResponse {
  days: number;
  window_start: string;
  window_end: string;
  reports: ServiceReportRow[];
}

// GET /api/fleet/dashboard (FR-WEB-014, extended for FR-WEB-033 — the
// "sub-tree" scoping this item calls for is already the hierarchy_path
// LIKE-prefix scoping every field below inherits, so no separate
// sub-tree-selector UI was needed; the new work was these two real fields).
export interface FleetDashboard {
  lifecycle_counts: { lifecycle_state: LifecycleState; count: string }[];
  summary?: { total: number; running: number; idle: number; fault: number; offline: number; no_data: number };
  connectivity: { online_count: string | number; offline_count: string | number; never_seen_count?: number; offline_after_seconds?: number };
  active_faults_by_type: { fault_code: number; name: string | null; severity: string | null; count: string }[];
  top_faulting_devices_30d: { id: string; name: string; fault_count: string }[];
  firmware_distribution: { firmware_version: string; count: string }[];
  faults_today_count: string | number;
  warranty_expiring_30d: { id: string; name: string; warranty_end_date: string }[];
}

// FR-WEB-032 config templates. desired_json uses the same layer-A key
// shape as DeviceConfig.desired_json.
export interface ConfigTemplate {
  id: string;
  name: string;
  description: string | null;
  desired_json: Record<string, number | boolean>;
  owner_user_id: string;
  owner_hierarchy_path: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConfigTemplateApplyResult {
  message: string;
  results: { pump_id: string; success: boolean; reason?: string }[];
}

// FR-WEB-034 component swap history. `current_mcu_uid` falls back to the
// claiming manufacturing batch's mcu_uid when no swap has ever been logged.
export interface McuSwapEntry {
  id: string;
  old_mcu_uid: string | null;
  new_mcu_uid: string;
  reason: string | null;
  occurred_at: string;
  performed_by_name: string | null;
}

export interface McuSwapHistory {
  current_mcu_uid: string | null;
  history: McuSwapEntry[];
}

export interface BridgeSwapResult {
  message: string;
  swap: { id: string; old_pump_id: string; new_pump_id: string; reason: string | null; occurred_at: string };
  new_pump_id: string;
  device_key: string;
}

// GET /api/branding/resolve|mine|:userId (FR-WEB-036). null means no
// branding applies anywhere in the caller's hierarchy_path ancestry —
// render the app's own default theme, never a fabricated placeholder.
export interface BrandingConfig {
  user_id?: string;
  logo_url: string | null;
  primary_color: string;
  notification_sender_name: string | null;
  subdomain: string | null;
  updated_at?: string;
}

// Server-side lifecycle adjacency map, mirrored for client-side hinting
// only — server.js LIFECYCLE_TRANSITIONS is the actual enforcement.
export const LIFECYCLE_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  MANUFACTURED: ['ALLOCATED'],
  ALLOCATED: ['IN_STOCK'],
  IN_STOCK: ['COMMISSIONED'],
  COMMISSIONED: ['ACTIVE'],
  ACTIVE: ['SUSPENDED', 'RMA', 'RETIRED'],
  SUSPENDED: ['ACTIVE', 'RMA', 'RETIRED'],
  RMA: ['IN_STOCK', 'RETIRED'],
  RETIRED: []
};

// Factory provisioning (FR-WEB-010/011, C-1). GET /api/batches row shape —
// imported_count/claimed_count are real aggregates from batch_imeis, not
// the declared `quantity` (a manufacturing-time estimate, may differ).
export interface DeviceBatch {
  id: string;
  batch_code: string;
  model: string;
  hw_rev: string | null;
  quantity: number;
  manufacture_date: string | null;
  created_by?: string | null;
  created_at: string;
  revoked: boolean;
  revoked_at: string | null;
  imported_count?: number;
  claimed_count?: number;
}

export interface BatchImei {
  id: string;
  imei: string;
  mcu_uid: string | null;
  claimed: boolean;
  claimed_at: string | null;
  pump_id: string | null;
  created_at: string;
}

export interface BatchImeiImportError {
  row: number;
  imei: string;
  reason: string;
}

export interface BatchImeiImportResult {
  message: string;
  inserted: { id: string; imei: string; mcu_uid: string | null }[];
  errors: BatchImeiImportError[];
}

// GET /api/system/health (FR-WEB-017). Every field is a live read or a
// counter incremented at the exact code path it names — see
// backend/services/metrics.js. No historical/time-series storage exists
// for these numbers, so this is a snapshot, not a trend.
export interface SystemHealth {
  status: 'OK' | 'DEGRADED';
  timestamp: string;
  process: { uptime_seconds: number; node_version: string; env: string; version?: string; python_version?: string };
  database: {
    connected: boolean;
    latency_ms?: number;
    pool_total: number;
    pool_idle: number;
    pool_waiting: number;
  };
  /** FastAPI backend uses requests_total / errors_4xx / errors_5xx.
   *  Legacy Node backend used http_requests_total / http_errors_4xx / http_errors_5xx.
   *  Both shapes are accepted; all keys are optional so either works. */
  metrics: {
    // FastAPI shape
    requests_total?: number;
    errors_4xx?: number;
    errors_5xx?: number;
    // Legacy Node shape
    http_requests_total?: number;
    http_errors_4xx?: number;
    http_errors_5xx?: number;
    // Common
    telemetry_ingest_success?: number;
    telemetry_ingest_failure?: number;
    sms_sent?: number;
    sms_failed?: number;
    whatsapp_sent?: number;
    whatsapp_failed?: number;
    [key: string]: number | undefined;
  };
  error?: string;
}

export interface AuditLogEntry {
  id: number;
  actor_id: string | null;
  actor_role: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  before_json: unknown;
  after_json: unknown;
  ip: string | null;
  occurred_at: string;
}

export interface AuthResult {
  token: string;
  refreshToken: string;
  expiresIn?: number;
  // Role requires MFA (superadmin/manufacturer — FR-WEB-001) but hasn't
  // configured it yet. Drives a blocking setup prompt, not a hard login block.
  mfa_setup_required?: boolean;
  user: User;
}

// Returned by verify-otp/login-password instead of AuthResult when the
// account already has TOTP enabled — no session yet, only a privilege-free
// challenge token good for POST /api/auth/mfa/verify (see authMiddleware.js,
// which explicitly rejects this shape everywhere else).
export interface MfaRequiredResult {
  mfa_required: true;
  mfa_token: string;
  expiresIn: number;
}

export type LoginOutcome = AuthResult | MfaRequiredResult;

export function isMfaRequired(result: LoginOutcome): result is MfaRequiredResult {
  return (result as MfaRequiredResult).mfa_required === true;
}

export type ThemeMode = 'light' | 'dark';

export type IndianLanguage =
  | 'as' | 'bn' | 'brx' | 'doi' | 'en' | 'gu' | 'hi' | 'kn' | 'ks'
  | 'kok' | 'mai' | 'ml' | 'mni' | 'mr' | 'ne' | 'or' | 'pa' | 'sa'
  | 'sat' | 'sd' | 'ta' | 'te' | 'ur';
