package com.example.pumpmonitor.ui.history

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.example.pumpmonitor.R
import com.example.pumpmonitor.data.TelemetryRow
import com.example.pumpmonitor.ui.PumpViewModel

private val metrics = listOf<Pair<String, (TelemetryRow) -> Float?>>(
    "V R-Y" to { it.vRyVolts },
    "V Y-B" to { it.vYbVolts },
    "V B-R" to { it.vBrVolts },
    "I R" to { it.iRAmps },
    "I Y" to { it.iYAmps },
    "I B" to { it.iBAmps },
)

@Composable
fun HistoryScreen(vm: PumpViewModel) {
    val points by vm.history.collectAsState()
    val error by vm.historyError.collectAsState()
    var metricIndex by remember { mutableStateOf(0) }
    var hours by remember { mutableStateOf(24) }

    LaunchedEffect(hours) { vm.loadHistory(hours) }

    Column(
        Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.history_title), style = MaterialTheme.typography.titleLarge)

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            metrics.forEachIndexed { i, (label, _) ->
                FilterChip(
                    selected = metricIndex == i,
                    onClick = { metricIndex = i },
                    label = { Text(label, style = MaterialTheme.typography.labelSmall) },
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(6, 24, 72, 168).forEach { h ->
                FilterChip(
                    selected = hours == h,
                    onClick = { hours = h },
                    label = { Text(if (h < 48) "${h}h" else "${h / 24}d") },
                )
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                val values = points.mapNotNull(metrics[metricIndex].second)
                when {
                    error != null -> Text(
                        stringResource(R.string.history_error, error ?: ""),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    values.isEmpty() -> Text(
                        stringResource(R.string.history_no_data),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    else -> LineChart(values, Modifier.fillMaxWidth().height(240.dp))
                }
            }
        }
    }
}

/** Minimal dependency-free line chart, x-axis by sample order (not wall-clock spacing). */
@Composable
private fun LineChart(values: List<Float>, modifier: Modifier = Modifier) {
    val min = values.min()
    val max = values.max()
    val range = (max - min).takeIf { it > 0f } ?: 1f

    Canvas(modifier) {
        val stepX = size.width / (values.size - 1).coerceAtLeast(1)
        val path = Path()
        values.forEachIndexed { i, v ->
            val x = i * stepX
            val y = size.height - ((v - min) / range) * size.height
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        for (frac in listOf(0f, 0.5f, 1f)) {
            val y = size.height * frac
            drawLine(Color(0x22000000), Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
        }
        drawPath(path, Color(0xFF00E5FF), style = Stroke(width = 4f))
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text("min %.1f".format(min), style = MaterialTheme.typography.labelSmall)
        Text("max %.1f".format(max), style = MaterialTheme.typography.labelSmall)
    }
}
