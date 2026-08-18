package com.example.pumpmonitor.data

import com.google.gson.annotations.SerializedName

/**
 * Wire types for backend/server.js (see docs/Android_App_Development_Plan.md
 * §Backend readiness for the endpoint map this was verified against).
 *
 * node-postgres serialises NUMERIC/DECIMAL and BIGINT/BIGSERIAL columns as
 * JSON *strings* (avoids silent float/int64 precision loss), not JSON
 * numbers — that's why voltages, currents, hp_rating, lat/long, ids on
 * BIGSERIAL tables, and COUNT(*) aggregates are all typed String? below and
 * parsed on demand, not trusted as pre-parsed numbers.
 */

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------

data class AuthUser(
    @SerializedName("id") val id: String,
    @SerializedName("full_name") val fullName: String,
    @SerializedName("phone_number") val phoneNumber: String,
    @SerializedName("role") val role: String,
    @SerializedName("hierarchy_path") val hierarchyPath: String,
    @SerializedName("totp_enabled") val totpEnabled: Boolean = false,
)

data class SendOtpRequest(@SerializedName("phone_number") val phoneNumber: String)

data class SendOtpResponse(
    @SerializedName("message") val message: String,
    @SerializedName("phone_number") val phoneNumber: String,
    @SerializedName("dev_otp") val devOtp: String? = null,
)

data class VerifyOtpRequest(
    @SerializedName("phone_number") val phoneNumber: String,
    @SerializedName("otp_code") val otpCode: String,
)

/** Shared shape of verify-otp / login-password / mfa-verify / refresh success. */
data class AuthResult(
    @SerializedName("mfa_required") val mfaRequired: Boolean = false,
    @SerializedName("mfa_token") val mfaToken: String? = null,
    @SerializedName("token") val token: String? = null,
    @SerializedName("refreshToken") val refreshToken: String? = null,
    @SerializedName("expiresIn") val expiresIn: Long = 0,
    @SerializedName("mfa_setup_required") val mfaSetupRequired: Boolean = false,
    @SerializedName("user") val user: AuthUser? = null,
)

data class MfaVerifyRequest(
    @SerializedName("mfa_token") val mfaToken: String,
    @SerializedName("code") val code: String,
)

data class RefreshRequest(@SerializedName("refreshToken") val refreshToken: String)
data class LogoutRequest(@SerializedName("refreshToken") val refreshToken: String? = null)

/** Generic `{ "error": "..." }` body Retrofit/OkHttp error responses carry. */
data class ApiError(@SerializedName("error") val error: String? = null)

// ---------------------------------------------------------------------
// Pumps
// ---------------------------------------------------------------------

/**
 * One row from GET /api/pumps, the `pump` field of GET /api/pumps/:id, and
 * the WebSocket `pump_update` payload — all three share this shape.
 */
data class Pump(
    @SerializedName("id") val id: String,
    @SerializedName("name") val name: String,
    @SerializedName("supply_type") val supplyType: String = "3-phase",
    @SerializedName("hp_rating") val hpRating: String? = null,
    @SerializedName("latitude") val latitude: String? = null,
    @SerializedName("longitude") val longitude: String? = null,
    @SerializedName("status") val status: String = "STOPPED",
    @SerializedName("lifecycle_state") val lifecycleState: String = "ACTIVE",
    @SerializedName("firmware_version") val firmwareVersion: String? = null,
    @SerializedName("last_seen_at") val lastSeenAt: String? = null,
    @SerializedName("v_ry") val vRy: String? = null,
    @SerializedName("v_yb") val vYb: String? = null,
    @SerializedName("v_br") val vBr: String? = null,
    @SerializedName("i_r") val iR: String? = null,
    @SerializedName("i_y") val iY: String? = null,
    @SerializedName("i_b") val iB: String? = null,
    @SerializedName("gsm_rssi") val gsmRssi: Int? = null,
    @SerializedName("telemetry_recorded_at") val telemetryRecordedAt: String? = null,
    @SerializedName("ts_approx") val tsApprox: Boolean? = null,
    @SerializedName("buffered") val buffered: Boolean? = null,
) {
    val vRyVolts: Float? get() = vRy?.toFloatOrNull()
    val vYbVolts: Float? get() = vYb?.toFloatOrNull()
    val vBrVolts: Float? get() = vBr?.toFloatOrNull()
    val iRAmps: Float? get() = iR?.toFloatOrNull()
    val iYAmps: Float? get() = iY?.toFloatOrNull()
    val iBAmps: Float? get() = iB?.toFloatOrNull()
    val hasTelemetry: Boolean get() = telemetryRecordedAt != null
}

data class PumpsListResponse(
    @SerializedName("meta") val meta: PumpsMeta,
    @SerializedName("pumps") val pumps: List<Pump>,
)

data class PumpsMeta(
    @SerializedName("page") val page: Int,
    @SerializedName("limit") val limit: Int,
    @SerializedName("stats") val stats: FleetStats? = null,
)

/** COUNT(*)/COUNT(*) FILTER results — BIGINT, so string-typed on the wire. */
data class FleetStats(
    @SerializedName("total_devices") val totalDevices: String? = null,
    @SerializedName("running_count") val runningCount: String? = null,
    @SerializedName("fault_count") val faultCount: String? = null,
    @SerializedName("stopped_count") val stoppedCount: String? = null,
    @SerializedName("offline_count") val offlineCount: String? = null,
)

data class PumpDetailResponse(
    @SerializedName("pump") val pump: Pump,
    @SerializedName("latest_telemetry") val latestTelemetry: TelemetryRow? = null,
    @SerializedName("config") val config: DeviceConfig? = null,
    @SerializedName("open_fault_count") val openFaultCount: Int = 0,
)

data class TelemetryRow(
    @SerializedName("recorded_at") val recordedAt: String,
    @SerializedName("v_ry") val vRy: String? = null,
    @SerializedName("v_yb") val vYb: String? = null,
    @SerializedName("v_br") val vBr: String? = null,
    @SerializedName("i_r") val iR: String? = null,
    @SerializedName("i_y") val iY: String? = null,
    @SerializedName("i_b") val iB: String? = null,
    @SerializedName("gsm_rssi") val gsmRssi: Int? = null,
    @SerializedName("pump_on") val pumpOn: Boolean? = null,
    @SerializedName("fault_active") val faultActive: Boolean? = null,
    @SerializedName("ts_approx") val tsApprox: Boolean? = null,
    @SerializedName("buffered") val buffered: Boolean? = null,
) {
    val vRyVolts: Float? get() = vRy?.toFloatOrNull()
    val vYbVolts: Float? get() = vYb?.toFloatOrNull()
    val vBrVolts: Float? get() = vBr?.toFloatOrNull()
    val iRAmps: Float? get() = iR?.toFloatOrNull()
    val iYAmps: Float? get() = iY?.toFloatOrNull()
    val iBAmps: Float? get() = iB?.toFloatOrNull()
}

data class TelemetryHistoryResponse(
    @SerializedName("pump_id") val pumpId: String,
    @SerializedName("count") val count: Int,
    @SerializedName("telemetry") val telemetry: List<TelemetryRow>,
)

data class DeviceConfig(
    @SerializedName("desired_json") val desiredJson: Map<String, Any?>? = null,
    @SerializedName("reported_json") val reportedJson: Map<String, Any?>? = null,
    @SerializedName("status") val status: String? = null,
    @SerializedName("updated_at") val updatedAt: String? = null,
)

// ---------------------------------------------------------------------
// Commands (start/stop, server-enforced 45s cooldown)
// ---------------------------------------------------------------------

data class CommandRequest(@SerializedName("action") val action: String) // "START" | "STOP"

data class CommandAccepted(
    @SerializedName("message") val message: String,
    @SerializedName("command") val command: Command? = null,
    @SerializedName("cooldownSec") val cooldownSec: Int = 0,
)

data class Command(
    @SerializedName("cid") val cid: String,
    @SerializedName("pump_id") val pumpId: String,
    @SerializedName("action") val action: String,
    @SerializedName("status") val status: String,
    @SerializedName("issued_at") val issuedAt: String,
    @SerializedName("expires_at") val expiresAt: String,
)

/** Body of a 409 REJECTED/COOLDOWN_ACTIVE response — the server-authoritative cooldown. */
data class CommandRejected(
    @SerializedName("error") val error: String? = null,
    @SerializedName("remainingSec") val remainingSec: Int = 0,
    @SerializedName("message") val message: String? = null,
)

// ---------------------------------------------------------------------
// Faults
// ---------------------------------------------------------------------

data class FaultLog(
    @SerializedName("id") val id: String,
    @SerializedName("pump_id") val pumpId: String,
    @SerializedName("occurred_at") val occurredAt: String,
    @SerializedName("fault_code") val faultCode: Int? = null,
    @SerializedName("fault_name") val faultName: String? = null,
    @SerializedName("severity") val severity: String? = null,
    @SerializedName("description") val description: String? = null,
    @SerializedName("contactor_tripped") val contactorTripped: Boolean = false,
    @SerializedName("ack_by_user_id") val ackByUserId: String? = null,
    @SerializedName("ack_at") val ackAt: String? = null,
    @SerializedName("resolved_at") val resolvedAt: String? = null,
)

data class FaultsResponse(
    @SerializedName("pump_id") val pumpId: String,
    @SerializedName("count") val count: Int,
    @SerializedName("faults") val faults: List<FaultLog>,
)

data class FaultAckRequest(@SerializedName("resolve") val resolve: Boolean)

// ---------------------------------------------------------------------
// Alerts (FR-WEB-060/062/063 — in-app only, see alertEngine.js)
// ---------------------------------------------------------------------

data class Alert(
    @SerializedName("id") val id: String,
    @SerializedName("pump_id") val pumpId: String,
    @SerializedName("pump_name") val pumpName: String? = null,
    @SerializedName("alert_type") val alertType: String,
    @SerializedName("severity") val severity: String, // CRITICAL | HIGH | MEDIUM | LOW
    @SerializedName("fault_code") val faultCode: Int? = null,
    @SerializedName("fault_name") val faultName: String? = null,
    @SerializedName("occurrence_count") val occurrenceCount: Int = 1,
    @SerializedName("first_occurred_at") val firstOccurredAt: String,
    @SerializedName("last_occurred_at") val lastOccurredAt: String,
    @SerializedName("acknowledged_by") val acknowledgedBy: String? = null,
    @SerializedName("acknowledged_by_name") val acknowledgedByName: String? = null,
    @SerializedName("acknowledged_at") val acknowledgedAt: String? = null,
    @SerializedName("assigned_to") val assignedTo: String? = null,
    @SerializedName("assigned_to_name") val assignedToName: String? = null,
    @SerializedName("resolved_at") val resolvedAt: String? = null,
    @SerializedName("resolution_note") val resolutionNote: String? = null,
)

data class AlertsResponse(@SerializedName("alerts") val alerts: List<Alert>)
data class AlertResolveRequest(@SerializedName("resolution_note") val resolutionNote: String? = null)
data class MessageResponse(@SerializedName("message") val message: String)

// ---------------------------------------------------------------------
// WebSocket envelope (ws://host/ws?token=..., FR-WEB-005)
// ---------------------------------------------------------------------

/** Discriminated by [type]; only the fields relevant to that type are populated. */
data class WsEnvelope(
    @SerializedName("type") val type: String,
    @SerializedName("pump") val pump: Pump? = null,
    @SerializedName("pump_id") val pumpId: String? = null,
    @SerializedName("fault") val fault: FaultLog? = null,
    @SerializedName("config") val config: DeviceConfig? = null,
    @SerializedName("alert") val alert: Alert? = null,
    @SerializedName("alerts") val alerts: List<Alert>? = null,
    @SerializedName("message") val message: String? = null,
)
