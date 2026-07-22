package com.agripump.smartspace.fcm

import android.app.Service
import android.content.Intent
import android.os.IBinder

class PumpMessagingService : Service() {
    override onBind(intent: Intent?): IBinder? {
        return null
    }
}
