package com.example.pumpmonitor.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.pumpmonitor.PumpApp
import com.example.pumpmonitor.data.Alert
import com.example.pumpmonitor.data.CommandOutcome
import com.example.pumpmonitor.data.FaultLog
import com.example.pumpmonitor.data.Pump
import com.example.pumpmonitor.data.TelemetryRow
import com.example.pumpmonitor.data.ws.WsConnectionState
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Backed entirely by [PumpApp.pumpRepository]/[PumpApp.alertRepository]/
 * [PumpApp.webSocketClient] — no direct MQTT/shadow parsing here anymore.
 * Command cooldown is server-authoritative (COMMAND_COOLDOWN_SECONDS in
 * server.js, surfaced via the 202/409 response), not a client-guessed timer.
 */
class PumpViewModel(app: Application) : AndroidViewModel(app) {

    private val pumpApp = app as PumpApp
    private val pumpRepo = pumpApp.pumpRepository
    private val alertRepo = pumpApp.alertRepository
    private val ws = pumpApp.webSocketClient
    private val authRepo = pumpApp.authRepository

    val pumps: StateFlow<List<Pump>> = pumpRepo.pumps
    val pumpsLoading: StateFlow<Boolean> = pumpRepo.loading
    val pumpsError: StateFlow<String?> = pumpRepo.error

    private val _selectedPumpId = MutableStateFlow<String?>(null)
    val selectedPumpId: StateFlow<String?> = _selectedPumpId

    val selectedPump: StateFlow<Pump?> = combine(pumps, _selectedPumpId) { list, id ->
        list.find { it.id == id }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    val wsConnectionState: StateFlow<WsConnectionState> = ws.state

    private val _openFaults = MutableStateFlow<List<FaultLog>>(emptyList())
    val openFaults: StateFlow<List<FaultLog>> = _openFaults

    private val _commandBusy = MutableStateFlow(false)
    val commandBusy: StateFlow<Boolean> = _commandBusy

    private val _commandCooldown = MutableStateFlow(0)
    val commandCooldownRemaining: StateFlow<Int> = _commandCooldown

    private val _commandError = MutableStateFlow<String?>(null)
    val commandError: StateFlow<String?> = _commandError
    private var cooldownJob: Job? = null

    private val _history = MutableStateFlow<List<TelemetryRow>>(emptyList())
    val history: StateFlow<List<TelemetryRow>> = _history
    private val _historyError = MutableStateFlow<String?>(null)
    val historyError: StateFlow<String?> = _historyError

    val alerts: StateFlow<List<Alert>> = alertRepo.alerts
    val alertsError: StateFlow<String?> = alertRepo.error

    init {
        viewModelScope.launch {
            authRepo.signedIn.collect { signedIn ->
                if (signedIn) {
                    ws.connect()
                    refreshPumps()
                    refreshAlerts()
                } else {
                    ws.disconnect()
                }
            }
        }
        viewModelScope.launch {
            pumpRepo.wsEvents.collect { envelope ->
                if (envelope.type == "fault" && envelope.pumpId == _selectedPumpId.value) {
                    refreshOpenFaults()
                }
            }
        }
    }

    fun refreshPumps() {
        viewModelScope.launch {
            pumpRepo.refreshPumps()
            // Minimal-navigation product direction (plan §3.2): 1-5 pumps
            // land straight on the pump screen (switcher dialog covers
            // 2-5); only a >5-pump account needs the searchable list first.
            if (_selectedPumpId.value == null) {
                val list = pumps.value
                if (list.size in 1..5) selectPump(list.first().id)
            }
        }
    }

    fun selectPump(pumpId: String) {
        _selectedPumpId.value = pumpId
        _commandError.value = null
        refreshOpenFaults()
    }

    fun closePump() {
        _selectedPumpId.value = null
        _openFaults.value = emptyList()
    }

    private fun refreshOpenFaults() {
        val id = _selectedPumpId.value ?: return
        viewModelScope.launch {
            pumpRepo.getFaults(id, openOnly = true).onSuccess { _openFaults.value = it }
        }
    }

    /** SRS §7.2 "Reset fault" — ack + resolve in one step (this app doesn't distinguish the two). */
    fun ackFault(fault: FaultLog) {
        viewModelScope.launch {
            pumpRepo.ackFault(fault.pumpId, fault.id, resolve = true)
            refreshOpenFaults()
        }
    }

    fun sendCommand(action: String) {
        val id = _selectedPumpId.value ?: return
        if (_commandBusy.value || _commandCooldown.value > 0) return
        _commandBusy.value = true
        _commandError.value = null
        viewModelScope.launch {
            when (val outcome = pumpRepo.sendCommand(id, action)) {
                is CommandOutcome.Accepted -> startCooldown(outcome.cooldownSec)
                is CommandOutcome.Cooldown -> {
                    _commandError.value = outcome.message
                    startCooldown(outcome.remainingSec)
                }
                is CommandOutcome.Error -> _commandError.value = outcome.message
            }
            _commandBusy.value = false
        }
    }

    private fun startCooldown(seconds: Int) {
        cooldownJob?.cancel()
        _commandCooldown.value = seconds
        cooldownJob = viewModelScope.launch {
            var remaining = seconds
            while (remaining > 0) {
                delay(1000)
                remaining--
                _commandCooldown.value = remaining
            }
        }
    }

    fun loadHistory(hours: Int) {
        val id = _selectedPumpId.value ?: return
        viewModelScope.launch {
            pumpRepo.getTelemetryHistory(id, hours)
                .onSuccess { _history.value = it; _historyError.value = null }
                .onFailure { _historyError.value = it.message }
        }
    }

    fun refreshAlerts() {
        viewModelScope.launch { alertRepo.refresh() }
    }

    fun ackAlert(alertId: String) {
        viewModelScope.launch { alertRepo.ack(alertId) }
    }

    fun resolveAlert(alertId: String) {
        viewModelScope.launch { alertRepo.resolve(alertId) }
    }
}
