package com.example.pumpmonitor.data

import com.google.gson.annotations.SerializedName

/**
 * Telemetry JSON published by the 3-phase pump controller, e.g.:
 * {
 *   "ts": 1720000000,
 *   "vRY": 423.4, "vYB": 437.4, "vBR": 424.9,
 *   "pRY": true,  "pYB": true,  "pBR": true,
 *   "iR": 9.1, "iY": 10.4, "iB": 9.4,
 *   "seqReverse": false,
 *   "totalRunSec": 84745, "lastCycleRunSec": 3737,
 *   "pumpOn": true, "gsmRssi": 24,
 *   "faults": []
 * }
 * Adjust field names to match your firmware payload.
 */
data class Telemetry(
    @SerializedName("ts") val timestamp: Long = 0,

    // Line-to-line voltages (440V system)
    @SerializedName("vRY") val vRY: Float = 0f,
    @SerializedName("vYB") val vYB: Float = 0f,
    @SerializedName("vBR") val vBR: Float = 0f,

    // Phase-present flags
    @SerializedName("pRY") val pRY: Boolean = false,
    @SerializedName("pYB") val pYB: Boolean = false,
    @SerializedName("pBR") val pBR: Boolean = false,

    // Phase currents (A)
    @SerializedName("iR") val iR: Float = 0f,
    @SerializedName("iY") val iY: Float = 0f,
    @SerializedName("iB") val iB: Float = 0f,

    /** true when phase sequence is reversed (not R->Y->B) */
    @SerializedName("seqReverse") val seqReverse: Boolean = false,

    @SerializedName("totalRunSec") val totalRunSec: Long = 0,
    @SerializedName("lastCycleRunSec") val lastCycleRunSec: Long = 0,

    @SerializedName("pumpOn") val pumpOn: Boolean = false,

    /** GSM signal 0..31 (AT+CSQ style) */
    @SerializedName("gsmRssi") val gsmRssi: Int = 0,

    /** Active fault strings, e.g. ["PHASE REVERSE", "OVERCURRENT Y"] */
    @SerializedName("faults") val faults: List<String> = emptyList(),
)

/** A pump registered to the signed-in user, from GET /pumps. */
data class Pump(
    /** IoT Thing name — drives MQTT topics, shadow, history and FCM topic. */
    @SerializedName("thingName") val thingName: String,
    /** Friendly display name, e.g. "Borewell Pump". */
    @SerializedName("name") val name: String,
    /** Optional, e.g. "North field". */
    @SerializedName("location") val location: String = "",
)

data class PumpsResponse(
    @SerializedName("pumps") val pumps: List<Pump>,
)

/** One point returned by the history API. */
data class HistoryPoint(
    @SerializedName("ts") val timestamp: Long,
    @SerializedName("value") val value: Float,
)

data class HistoryResponse(
    @SerializedName("metric") val metric: String,
    @SerializedName("points") val points: List<HistoryPoint>,
)

/** In-app alert entry (also produced from FCM pushes). */
data class PumpAlert(
    val timestamp: Long,
    val severity: String,   // INFO | WARNING | CRITICAL
    val title: String,
    val message: String,
)
