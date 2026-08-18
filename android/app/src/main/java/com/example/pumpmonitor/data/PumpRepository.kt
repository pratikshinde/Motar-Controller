package com.example.pumpmonitor.data

import com.example.pumpmonitor.data.net.PumpApi
import com.example.pumpmonitor.data.ws.WebSocketClient
import com.google.gson.Gson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import retrofit2.Response

sealed interface CommandOutcome {
    data class Accepted(val cooldownSec: Int) : CommandOutcome
    data class Cooldown(val remainingSec: Int, val message: String) : CommandOutcome
    data class Error(val message: String) : CommandOutcome
}

/**
 * Pump list, backed by GET /api/pumps and kept live via the WebSocket hub's
 * `pump_update` broadcasts (merged into the in-memory list by id — the same
 * shape backs both, see [Pump]). Also the single place that dispatches
 * START/STOP commands, surfacing the server's authoritative 45s cooldown
 * (COMMAND_COOLDOWN_SECONDS in server.js) rather than a client-guessed timer.
 */
class PumpRepository(
    private val pumpApi: PumpApi,
    private val webSocketClient: WebSocketClient,
) {
    private val gson = Gson()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val _pumps = MutableStateFlow<List<Pump>>(emptyList())
    val pumps: StateFlow<List<Pump>> = _pumps

    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    /** Raw WS envelopes, for screens that need message types this repository doesn't own (fault/alert). */
    val wsEvents: SharedFlow<WsEnvelope> = webSocketClient.messages

    init {
        scope.launch {
            webSocketClient.messages.collect { envelope ->
                if (envelope.type == "pump_update") {
                    envelope.pump?.let { applyPumpUpdate(it) }
                }
            }
        }
    }

    suspend fun refreshPumps() {
        _loading.value = true
        try {
            val response = pumpApi.getPumps()
            if (response.isSuccessful) {
                _pumps.value = response.body()?.pumps ?: emptyList()
                _error.value = null
            } else {
                _error.value = parseError(response)
            }
        } catch (e: Exception) {
            _error.value = e.message ?: "Couldn't load your pumps"
        } finally {
            _loading.value = false
        }
    }

    private fun applyPumpUpdate(updated: Pump) {
        val current = _pumps.value
        _pumps.value = if (current.any { it.id == updated.id }) {
            current.map { if (it.id == updated.id) updated else it }
        } else {
            current + updated
        }
    }

    suspend fun sendCommand(pumpId: String, action: String): CommandOutcome {
        return try {
            val response = pumpApi.sendCommand(pumpId, CommandRequest(action))
            when {
                response.isSuccessful -> CommandOutcome.Accepted(response.body()?.cooldownSec ?: 0)
                response.code() == 409 -> {
                    val rejected = runCatching {
                        gson.fromJson(response.errorBody()?.string(), CommandRejected::class.java)
                    }.getOrNull()
                    CommandOutcome.Cooldown(
                        rejected?.remainingSec ?: 0,
                        rejected?.message ?: "Command rejected — cooldown active",
                    )
                }
                else -> CommandOutcome.Error(parseError(response))
            }
        } catch (e: Exception) {
            CommandOutcome.Error(e.message ?: "Network error")
        }
    }

    suspend fun getFaults(pumpId: String, openOnly: Boolean): Result<List<FaultLog>> = runCatching {
        val response = pumpApi.getFaults(pumpId, open = if (openOnly) true else null)
        if (!response.isSuccessful) throw RuntimeException(parseError(response))
        response.body()?.faults ?: emptyList()
    }

    suspend fun ackFault(pumpId: String, faultId: String, resolve: Boolean): Result<Unit> = runCatching {
        val response = pumpApi.ackFault(pumpId, faultId, FaultAckRequest(resolve))
        if (!response.isSuccessful) throw RuntimeException(parseError(response))
    }

    suspend fun getTelemetryHistory(pumpId: String, hours: Int): Result<List<TelemetryRow>> = runCatching {
        val response = pumpApi.getTelemetry(pumpId, hours = hours)
        if (!response.isSuccessful) throw RuntimeException(parseError(response))
        response.body()?.telemetry ?: emptyList()
    }

    private fun parseError(response: Response<*>): String {
        val raw = response.errorBody()?.string()
        val parsed = runCatching { gson.fromJson(raw, ApiError::class.java)?.error }.getOrNull()
        return parsed ?: "Request failed (HTTP ${response.code()})"
    }
}
