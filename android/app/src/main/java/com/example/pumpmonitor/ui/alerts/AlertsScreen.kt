package com.example.pumpmonitor.ui.alerts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.example.pumpmonitor.R
import com.example.pumpmonitor.data.Alert
import com.example.pumpmonitor.ui.PumpViewModel
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * FR-WEB-060/062/063, in-app only (see backend/services/alertEngine.js) —
 * delivered live over the WS hub while this session is connected, real
 * push (FCM) is Phase 2.
 */
@Composable
fun AlertsScreen(vm: PumpViewModel) {
    val alerts by vm.alerts.collectAsState()
    val error by vm.alertsError.collectAsState()

    LaunchedEffect(Unit) { vm.refreshAlerts() }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.alerts_title), style = MaterialTheme.typography.titleLarge)
        Text(stringResource(R.string.alerts_description), style = MaterialTheme.typography.bodySmall)
        when {
            error != null -> Text(error ?: "", style = MaterialTheme.typography.bodySmall)
            alerts.isEmpty() -> Text(stringResource(R.string.alerts_empty), style = MaterialTheme.typography.bodyMedium)
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(alerts, key = { it.id }) { alert ->
                    AlertCard(
                        alert = alert,
                        onAck = { vm.ackAlert(alert.id) },
                        onResolve = { vm.resolveAlert(alert.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun AlertCard(alert: Alert, onAck: () -> Unit, onResolve: () -> Unit) {
    val color = when (alert.severity) {
        "CRITICAL" -> Color(0xFFC62828)
        "HIGH" -> Color(0xFFEF6C00)
        "MEDIUM" -> Color(0xFFF9A825)
        else -> Color(0xFF1565C0)
    }
    val formatter = remember(alert.id) { DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT) }
    val whenText = runCatching {
        Instant.parse(alert.lastOccurredAt).atZone(java.time.ZoneId.systemDefault()).format(formatter)
    }.getOrDefault(alert.lastOccurredAt)

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text(
                (alert.faultName ?: alert.alertType).uppercase(),
                color = color, style = MaterialTheme.typography.titleSmall,
            )
            Text("${alert.pumpName ?: alert.pumpId}", style = MaterialTheme.typography.bodyMedium)
            if (alert.occurrenceCount > 1) {
                Text(
                    stringResource(R.string.alert_occurred_count, alert.occurrenceCount),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Text(whenText, style = MaterialTheme.typography.labelSmall)
            if (alert.resolvedAt == null) {
                Row {
                    if (alert.acknowledgedAt == null) {
                        TextButton(onClick = onAck) { Text(stringResource(R.string.alert_ack)) }
                    }
                    TextButton(onClick = onResolve) { Text(stringResource(R.string.alert_resolve)) }
                }
            } else {
                Text(stringResource(R.string.alert_resolved), style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
