package com.example.pumpmonitor

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.example.pumpmonitor.aws.IotMqttClient
import com.example.pumpmonitor.data.HistoryApi

class PumpApp : Application() {

    lateinit var iot: IotMqttClient
        private set

    val historyApi: HistoryApi by lazy { HistoryApi.create() }

    override fun onCreate() {
        super.onCreate()
        iot = IotMqttClient(this)
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
