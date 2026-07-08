package com.example.pumpmonitor.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.pumpmonitor.PumpApp
import com.example.pumpmonitor.aws.ConnectionState
import com.example.pumpmonitor.data.HistoryPoint
import com.example.pumpmonitor.data.PumpAlert
import com.example.pumpmonitor.data.Telemetry
import com.google.gson.Gson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class PumpViewModel(app: Application) : AndroidViewModel(app) {

    private val pumpApp = app as PumpApp
    private val iot = pumpApp.iot
    private val gson = Gson()

    val connectionState: StateFlow<ConnectionState> = iot.connectionState

    /** Latest live telemetry, parsed from the MQTT payload. */
    val telemetry: StateFlow<Telemetry?> = iot.telemetryJson
        .map { json ->
            json?.let {
                runCatching { gson.fromJson(it, Telemetry::class.java) }.getOrNull()
            }
        }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /** Pump state as confirmed by the device shadow ("reported"). */
    val reportedPumpOn: StateFlow<Boolean?> = iot.shadowReported
        .map { it?.get("pump")?.asString?.equals("ON", ignoreCase = true) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /** True between sending a command and the shadow confirming it. */
    private val _commandPending = MutableStateFlow(false)
    val commandPending: StateFlow<Boolean> = _commandPending

    private val _history = MutableStateFlow<List<HistoryPoint>>(emptyList())
    val history: StateFlow<List<HistoryPoint>> = _history

    private val _historyError = MutableStateFlow<String?>(null)
    val historyError: StateFlow<String?> = _historyError

    private val _alerts = MutableStateFlow<List<PumpAlert>>(emptyList())
    val alerts: StateFlow<List<PumpAlert>> = _alerts

    init {
        iot.connect()
        // Clear "pending" once the shadow reports any change.
        viewModelScope.launch {
            iot.shadowReported.collect { if (it != null) _commandPending.value = false }
        }
    }

    fun setPump(on: Boolean) {
        _commandPending.value = true
        iot.setDesiredState(mapOf("pump" to if (on) "ON" else "OFF"))
    }

    fun loadHistory(metric: String = "vRY", hours: Int = 24) {
        viewModelScope.launch {
            runCatching { pumpApp.historyApi.getHistory(metric = metric, hours = hours) }
                .onSuccess {
                    _history.value = it.points
                    _historyError.value = null
                }
                .onFailure { _historyError.value = it.message ?: "Failed to load history" }
        }
    }

    override fun onCleared() {
        iot.disconnect()
    }
}
