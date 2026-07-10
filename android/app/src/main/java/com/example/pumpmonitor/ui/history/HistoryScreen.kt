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
import com.example.pumpmonitor.data.HistoryPoint
import com.example.pumpmonitor.ui.PumpViewModel

private val metrics = listOf(
    "vRY" to "V RY",
    "vYB" to "V YB",
    "vBR" to "V BR",
    "iR" to "I R",
    "iY" to "I Y",
    "iB" to "I B",
)

@Composable
fun HistoryScreen(vm: PumpViewModel) {
    val points by vm.history.collectAsState()
    val error by vm.historyError.collectAsState()
    var metric by remember { mutableStateOf("vRY") }
    var hours by remember { mutableStateOf(24) }

    LaunchedEffect(metric, hours) { vm.loadHistory(metric, hours) }

    Column(
        Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.history_title), style = MaterialTheme.typography.titleLarge)

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            metrics.forEach { (key, label) ->
                FilterChip(
                    selected = metric == key,
                    onClick = { metric = key },
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
                when {
                    error != null -> Text(
                        stringResource(R.string.history_error, error ?: ""),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    points.isEmpty() -> Text(
                        stringResource(R.string.history_no_data),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    else -> LineChart(points, Modifier.fillMaxWidth().height(240.dp))
                }
            }
        }
    }
}

/** Minimal dependency-free line chart. Swap for Vico/MPAndroidChart if you prefer. */
@Composable
private fun LineChart(points: List<HistoryPoint>, modifier: Modifier = Modifier) {
    val min = points.minOf { it.value }
    val max = points.maxOf { it.value }
    val range = (max - min).takeIf { it > 0f } ?: 1f

    Canvas(modifier) {
        val stepX = size.width / (points.size - 1).coerceAtLeast(1)
        val path = Path()
        points.forEachIndexed { i, p ->
            val x = i * stepX
            val y = size.height - ((p.value - min) / range) * size.height
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        // Baseline grid
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
