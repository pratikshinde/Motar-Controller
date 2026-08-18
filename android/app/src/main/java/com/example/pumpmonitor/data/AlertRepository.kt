package com.example.pumpmonitor.data

import com.example.pumpmonitor.data.net.PumpApi
import com.example.pumpmonitor.data.ws.WebSocketClient
import com.google.gson.Gson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import retrofit2.Response

/**
 * Alerts inbox (FR-WEB-060/062/063), backed by GET /api/alerts and kept
 * live via the WS hub's per-subscriber `alert` / `alert_digest` messages
 * (delivered only while this session is connected — see alertEngine.js;
 * real push is Phase 2, out of scope here).
 */
class AlertRepository(
    private val pumpApi: PumpApi,
    private val webSocketClient: WebSocketClient,
) {
    private val gson = Gson()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val _alerts = MutableStateFlow<List<Alert>>(emptyList())
    val alerts: StateFlow<List<Alert>> = _alerts

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    init {
        scope.launch {
            webSocketClient.messages.collect { envelope ->
                when (envelope.type) {
                    "alert" -> envelope.alert?.let { upsert(it) }
                    "alert_digest" -> envelope.alerts?.forEach { upsert(it) }
                }
            }
        }
    }

    private fun upsert(alert: Alert) {
        val current = _alerts.value
        val next = if (current.any { it.id == alert.id }) {
            current.map { if (it.id == alert.id) alert else it }
        } else {
            listOf(alert) + current
        }
        _alerts.value = next.sortedByDescending { it.lastOccurredAt }
    }

    suspend fun refresh(status: String? = null, pumpId: String? = null) {
        try {
            val response = pumpApi.getAlerts(status = status, pumpId = pumpId)
            if (response.isSuccessful) {
                _alerts.value = (response.body()?.alerts ?: emptyList()).sortedByDescending { it.lastOccurredAt }
                _error.value = null
            } else {
                _error.value = parseError(response)
            }
        } catch (e: Exception) {
            _error.value = e.message ?: "Couldn't load alerts"
        }
    }

    suspend fun ack(alertId: String): Result<Unit> = runCatching {
        val response = pumpApi.ackAlert(alertId)
        if (!response.isSuccessful) throw RuntimeException(parseError(response))
    }

    suspend fun resolve(alertId: String, note: String? = null): Result<Unit> = runCatching {
        val response = pumpApi.resolveAlert(alertId, AlertResolveRequest(note))
        if (!response.isSuccessful) throw RuntimeException(parseError(response))
    }

    private fun parseError(response: Response<*>): String {
        val raw = response.errorBody()?.string()
        val parsed = runCatching { gson.fromJson(raw, ApiError::class.java)?.error }.getOrNull()
        return parsed ?: "Request failed (HTTP ${response.code()})"
    }
}
