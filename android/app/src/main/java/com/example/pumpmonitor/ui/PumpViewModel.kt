package com.example.pumpmonitor.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.pumpmonitor.PumpApp
import com.example.pumpmonitor.aws.AwsConfig
import com.example.pumpmonitor.aws.ConnectionState
import com.example.pumpmonitor.data.HistoryPoint
import com.example.pumpmonitor.data.Pump
import com.example.pumpmonitor.data.PumpAlert
import com.example.pumpmonitor.data.Telemetry
import com.google.firebase.messaging.FirebaseMessaging
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

    // Default pump pre-selected on app launch
    private val defaultPump = Pump(
        thingName = AwsConfig.DEFAULT_THING_NAME,
        name = "Borewell Pump #1 (15 HP)",
        location = "Nashik Field #4"
    )

    private val _pumps = MutableStateFlow<List<Pump>>(listOf(defaultPump))
    val pumps: StateFlow<List<Pump>> = _pumps

    private val _pumpsLoading = MutableStateFlow(false)
    val pumpsLoading: StateFlow<Boolean> = _pumpsLoading

    private val _pumpsError = MutableStateFlow<String?>(null)
    val pumpsError: StateFlow<String?> = _pumpsError

    private val _selectedPump = MutableStateFlow<Pump?>(defaultPump)
    val selectedPump: StateFlow<Pump?> = _selectedPump

    fun loadPumps(userId: String) {
        viewModelScope.launch {
            _pumpsLoading.value = true
            runCatching { pumpApp.api.getPumps(userId) }
                .onSuccess {
                    if (it.pumps.isNotEmpty()) {
                        _pumps.value = it.pumps
                        _selectedPump.value = it.pumps.first()
                    }
                    _pumpsError.value = null
                }
                .onFailure {
                    _pumps.value = listOf(defaultPump)
                    _selectedPump.value = defaultPump
                    _pumpsError.value = null
                }
            _pumpsLoading.value = false
            subscribeAlertTopics()
        }
    }

    private fun subscribeAlertTopics() {
        runCatching {
            val fcm = FirebaseMessaging.getInstance()
            _pumps.value.forEach { fcm.subscribeToTopic("pump-${it.thingName}") }
        }
    }

    fun selectPump(pump: Pump) {
        _selectedPump.value = pump
        _commandPending.value = false
        _history.value = emptyList()
        _historyError.value = null
        iot.disconnect()
        iot.connect(pump.thingName)
    }

    fun closePump() {
        iot.disconnect()
    }

    val connectionState: StateFlow<ConnectionState> = iot.connectionState

    val telemetry: StateFlow<Telemetry?> = iot.telemetryJson
        .map { json ->
            json?.let {
                runCatching { gson.fromJson(it, Telemetry::class.java) }.getOrNull()
            }
        }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    val reportedPumpOn: StateFlow<Boolean?> = iot.shadowReported
        .map { it?.get("pump")?.asString?.equals("ON", ignoreCase = true) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val _commandPending = MutableStateFlow(false)
    val commandPending: StateFlow<Boolean> = _commandPending

    private val _history = MutableStateFlow<List<HistoryPoint>>(emptyList())
    val history: StateFlow<List<HistoryPoint>> = _history

    private val _historyError = MutableStateFlow<String?>(null)
    val historyError: StateFlow<String?> = _historyError

    private val _alerts = MutableStateFlow<List<PumpAlert>>(emptyList())
    val alerts: StateFlow<List<PumpAlert>> = _alerts

    init {
        viewModelScope.launch {
            iot.shadowReported.collect { if (it != null) _commandPending.value = false }
        }
    }

    fun setPump(on: Boolean) {
        _commandPending.value = true
        iot.setDesiredState(mapOf("pump" to if (on) "ON" else "OFF"))
    }

    fun loadHistory(metric: String = "vRY", hours: Int = 24) {
        val thing = _selectedPump.value?.thingName ?: return
        viewModelScope.launch {
            runCatching { pumpApp.api.getHistory(pumpId = thing, metric = metric, hours = hours) }
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
