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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.example.pumpmonitor.R
import com.example.pumpmonitor.data.PumpAlert
import com.example.pumpmonitor.ui.PumpViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// FCM topic subscription happens in PumpViewModel.loadPumps — one topic per
// owned pump ("pump-<thingName>") so pushes arrive for all of the user's pumps.

@Composable
fun AlertsScreen(vm: PumpViewModel) {
    val alerts by vm.alerts.collectAsState()

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.alerts_title), style = MaterialTheme.typography.titleLarge)
        Text(
            stringResource(R.string.alerts_description),
            style = MaterialTheme.typography.bodySmall,
        )
        if (alerts.isEmpty()) {
            Text(stringResource(R.string.alerts_empty), style = MaterialTheme.typography.bodyMedium)
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
