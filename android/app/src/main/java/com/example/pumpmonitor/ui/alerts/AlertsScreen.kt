package com.example.pumpmonitor.ui.alerts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.example.pumpmonitor.aws.AwsConfig
import com.example.pumpmonitor.data.PumpAlert
import com.example.pumpmonitor.ui.PumpViewModel
import com.google.firebase.messaging.FirebaseMessaging
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun AlertsScreen(vm: PumpViewModel) {
    val alerts by vm.alerts.collectAsState()

    // Subscribe to this pump's FCM topic so backend Lambdas can push to
    // "pump-<thingName>" without tracking device tokens.
    LaunchedEffect(Unit) {
        runCatching {
            FirebaseMessaging.getInstance().subscribeToTopic("pump-${AwsConfig.THING_NAME}")
        }
    }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Alerts", style = MaterialTheme.typography.titleLarge)
        Text(
            "Push notifications arrive even when the app is closed (dry-run, overload, " +
                "tank full). Recent alerts received while the app is open appear below.",
            style = MaterialTheme.typography.bodySmall,
        )
        if (alerts.isEmpty()) {
            Text("No alerts in this session.", style = MaterialTheme.typography.bodyMedium)
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(alerts) { AlertCard(it) }
            }
        }
    }
}

@Composable
private fun AlertCard(alert: PumpAlert) {
    val fmt = SimpleDateFormat("dd MMM HH:mm", Locale.getDefault())
    val color = when (alert.severity) {
        "CRITICAL" -> Color(0xFFC62828)
        "WARNING" -> Color(0xFFF9A825)
        else -> Color(0xFF1565C0)
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text(alert.title, color = color, style = MaterialTheme.typography.titleSmall)
            Text(alert.message, style = MaterialTheme.typography.bodyMedium)
            Text(fmt.format(Date(alert.timestamp)), style = MaterialTheme.typography.labelSmall)
        }
    }
}
