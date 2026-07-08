package com.example.pumpmonitor.aws

import android.content.Context
import android.util.Log
import com.amazonaws.auth.CognitoCachingCredentialsProvider
import com.amazonaws.mobileconnectors.iot.AWSIotMqttClientStatusCallback
import com.amazonaws.mobileconnectors.iot.AWSIotMqttManager
import com.amazonaws.mobileconnectors.iot.AWSIotMqttQos
import com.google.gson.Gson
import com.google.gson.JsonObject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.UUID

enum class ConnectionState { CONNECTING, CONNECTED, RECONNECTING, DISCONNECTED }

/**
 * Single MQTT-over-WebSockets connection to AWS IoT Core, authenticated with
 * temporary credentials from a Cognito Identity Pool (no certs in the APK).
 *
 * Exposes:
 *  - [connectionState]  connection lifecycle as a StateFlow
 *  - [telemetryJson]    raw JSON of the latest telemetry message
 *  - [shadowReported]   latest "reported" state from the device shadow
 *  - [setDesiredState]  writes "desired" state to the shadow (pump control)
 */
class IotMqttClient(context: Context) {

    private val tag = "IotMqttClient"
    private val gson = Gson()

    private val credentialsProvider = CognitoCachingCredentialsProvider(
        context.applicationContext,
        AwsConfig.COGNITO_IDENTITY_POOL_ID,
        AwsConfig.REGION
    )

    // Unique client id per install; IoT Core kicks duplicate client ids.
    private val mqttManager = AWSIotMqttManager(
        "pump-app-" + UUID.randomUUID().toString(),
        AwsConfig.IOT_ENDPOINT
    ).apply {
        keepAlive = 30                     // seconds
        setAutoReconnect(true)
    }

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState

    private val _telemetryJson = MutableStateFlow<String?>(null)
    val telemetryJson: StateFlow<String?> = _telemetryJson

    private val _shadowReported = MutableStateFlow<JsonObject?>(null)
    val shadowReported: StateFlow<JsonObject?> = _shadowReported

    fun connect() {
        _connectionState.value = ConnectionState.CONNECTING
        try {
            mqttManager.connect(credentialsProvider,
                AWSIotMqttClientStatusCallback { status, throwable ->
                    Log.d(tag, "MQTT status: $status", throwable)
                    when (status) {
                        AWSIotMqttClientStatusCallback.AWSIotMqttClientStatus.Connected -> {
                            _connectionState.value = ConnectionState.CONNECTED
                            onConnected()
                        }
                        AWSIotMqttClientStatusCallback.AWSIotMqttClientStatus.Connecting ->
                            _connectionState.value = ConnectionState.CONNECTING
                        AWSIotMqttClientStatusCallback.AWSIotMqttClientStatus.Reconnecting ->
                            _connectionState.value = ConnectionState.RECONNECTING
                        else ->
                            _connectionState.value = ConnectionState.DISCONNECTED
                    }
                })
        } catch (e: Exception) {
            Log.e(tag, "connect() failed", e)
            _connectionState.value = ConnectionState.DISCONNECTED
        }
    }

    /** Subscribe + request current shadow every time we (re)connect. */
    private fun onConnected() {
        subscribe(AwsConfig.TELEMETRY_TOPIC) { payload ->
            _telemetryJson.value = payload
        }
        subscribe(AwsConfig.SHADOW_GET_ACCEPTED) { payload -> parseShadow(payload) }
        subscribe(AwsConfig.SHADOW_UPDATE_ACCEPTED) { payload -> parseShadow(payload) }

        // Ask for the current shadow document so the UI is never stale.
        publish(AwsConfig.SHADOW_GET, "")
    }

    private fun subscribe(topic: String, onMessage: (String) -> Unit) {
        try {
            mqttManager.subscribeToTopic(topic, AWSIotMqttQos.QOS0) { _, data ->
                onMessage(String(data, Charsets.UTF_8))
            }
        } catch (e: Exception) {
            Log.e(tag, "subscribe($topic) failed", e)
        }
    }

    private fun parseShadow(payload: String) {
        try {
            val root = gson.fromJson(payload, JsonObject::class.java)
            val reported = root.getAsJsonObject("state")?.getAsJsonObject("reported")
            if (reported != null) _shadowReported.value = reported
        } catch (e: Exception) {
            Log.e(tag, "Bad shadow payload", e)
        }
    }

    /**
     * Pump control via Device Shadow. Example: setDesiredState(mapOf("pump" to "ON")).
     * The pump firmware receives the delta, actuates, then reports back —
     * commands survive the pump being temporarily offline.
     */
    fun setDesiredState(desired: Map<String, Any>) {
        val doc = mapOf("state" to mapOf("desired" to desired))
        publish(AwsConfig.SHADOW_UPDATE, gson.toJson(doc))
    }

    fun publish(topic: String, message: String) {
        try {
            mqttManager.publishString(message, topic, AWSIotMqttQos.QOS0)
        } catch (e: Exception) {
            Log.e(tag, "publish($topic) failed", e)
        }
    }

    fun disconnect() {
        try {
            mqttManager.disconnect()
        } catch (_: Exception) { }
        _connectionState.value = ConnectionState.DISCONNECTED
    }
}
