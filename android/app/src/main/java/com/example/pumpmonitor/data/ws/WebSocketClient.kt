package com.example.pumpmonitor.data.ws

import android.util.Log
import com.example.pumpmonitor.data.AppConfig
import com.example.pumpmonitor.data.WsEnvelope
import com.example.pumpmonitor.data.auth.TokenStore
import com.google.gson.Gson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.Response as OkResponse

enum class WsConnectionState { DISCONNECTED, CONNECTING, CONNECTED }

/**
 * FR-WEB-005 live-update client. One socket for the whole signed-in session
 * — the hub fans out pump_update/fault/config_update/alert/alert_digest to
 * every connection already scoped (by hierarchy_path or subscriber id) at
 * the server, so there's no per-pump subscribe/unsubscribe, unlike the
 * per-pump AWS IoT MQTT connection this replaces. Reconnects with capped
 * exponential backoff on any drop, re-reading the access token each attempt
 * since it may have been refreshed since the last connect.
 */
class WebSocketClient(private val tokenStore: TokenStore) {

    private val tag = "WebSocketClient"
    private val gson = Gson()
    private val client = OkHttpClient.Builder().build()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var socket: WebSocket? = null
    private var reconnectJob: Job? = null
    private var wanted = false
    private var attempt = 0

    private val _state = MutableStateFlow(WsConnectionState.DISCONNECTED)
    val state: StateFlow<WsConnectionState> = _state

    private val _messages = MutableSharedFlow<WsEnvelope>(extraBufferCapacity = 64)
    val messages: SharedFlow<WsEnvelope> = _messages

    fun connect() {
        wanted = true
        attempt = 0
        openSocket()
    }

    fun disconnect() {
        wanted = false
        reconnectJob?.cancel()
        socket?.close(1000, "client disconnect")
        socket = null
        _state.value = WsConnectionState.DISCONNECTED
    }

    private fun openSocket() {
        val token = tokenStore.accessToken
        if (token == null) {
            _state.value = WsConnectionState.DISCONNECTED
            return
        }
        _state.value = WsConnectionState.CONNECTING
        val request = Request.Builder().url("${AppConfig.WS_BASE_URL}?token=$token").build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: OkResponse) {
                attempt = 0
                _state.value = WsConnectionState.CONNECTED
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val envelope = runCatching { gson.fromJson(text, WsEnvelope::class.java) }.getOrNull() ?: return
                _messages.tryEmit(envelope)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                _state.value = WsConnectionState.DISCONNECTED
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: OkResponse?) {
                Log.w(tag, "WebSocket failure: ${t.message}")
                _state.value = WsConnectionState.DISCONNECTED
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (!wanted) return
        reconnectJob?.cancel()
        val delayMs = (1000L * (1L shl attempt.coerceAtMost(5))).coerceAtMost(30_000L)
        attempt++
        reconnectJob = scope.launch {
            delay(delayMs)
            if (wanted) openSocket()
        }
    }
}
