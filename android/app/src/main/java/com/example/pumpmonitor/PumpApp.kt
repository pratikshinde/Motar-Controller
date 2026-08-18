package com.example.pumpmonitor

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.example.pumpmonitor.data.AlertRepository
import com.example.pumpmonitor.data.PumpRepository
import com.example.pumpmonitor.data.auth.AuthRepository
import com.example.pumpmonitor.data.auth.TokenStore
import com.example.pumpmonitor.data.net.ApiClient
import com.example.pumpmonitor.data.ws.WebSocketClient

/**
 * Manual, Application-scoped DI (no framework, matching the rest of this
 * codebase). Construction order matters: TokenStore has no dependencies;
 * ApiClient needs TokenStore plus a session-expired callback that reaches
 * back into AuthRepository, so AuthRepository is constructed first with a
 * `lateinit`-free forward reference via a small wiring trick below.
 */
class PumpApp : Application() {

    lateinit var tokenStore: TokenStore
        private set
    lateinit var apiClient: ApiClient
        private set
    lateinit var authRepository: AuthRepository
        private set
    lateinit var webSocketClient: WebSocketClient
        private set
    lateinit var pumpRepository: PumpRepository
        private set
    lateinit var alertRepository: AlertRepository
        private set

    override fun onCreate() {
        super.onCreate()

        tokenStore = TokenStore(this)
        apiClient = ApiClient(tokenStore, onSessionExpired = { authRepository.onSessionExpired() })
        authRepository = AuthRepository(tokenStore, apiClient.authApi)
        webSocketClient = WebSocketClient(tokenStore)
        pumpRepository = PumpRepository(apiClient.pumpApi, webSocketClient)
        alertRepository = AlertRepository(apiClient.pumpApi, webSocketClient)

        createAlertChannel()
    }

    private fun createAlertChannel() {
        val channel = NotificationChannel(
            ALERT_CHANNEL_ID,
            "Pump alerts",
            NotificationManager.IMPORTANCE_HIGH
        ).apply { description = "Dry-run, overload and tank alerts" }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        const val ALERT_CHANNEL_ID = "pump_alerts"
    }
}
