package com.example.pumpmonitor.fcm

import android.app.Notification
import android.app.NotificationManager
import android.util.Log
import com.example.pumpmonitor.PumpApp
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives pump alert pushes.
 * Backend path: IoT Rule (e.g. seqReverse = true, phase missing, iR/iY/iB > limit)
 *   -> Lambda -> FCM HTTP v1 API -> this service.
 *
 * Subscribe the app to a per-pump topic so the Lambda can just publish to
 * "pump-WaterPump01" without tracking device tokens:
 *   FirebaseMessaging.getInstance().subscribeToTopic("pump-WaterPump01")
 */
class PumpMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        // If you target individual devices instead of topics, ship this token
        // to your backend (API Gateway endpoint) here.
        Log.d("PumpFCM", "New FCM token: $token")
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title
            ?: message.data["title"] ?: "Pump alert"
        val body = message.notification?.body
            ?: message.data["message"] ?: ""

        val notification = Notification.Builder(this, PumpApp.ALERT_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .build()

        getSystemService(NotificationManager::class.java)
            .notify(System.currentTimeMillis().toInt(), notification)
    }
}
