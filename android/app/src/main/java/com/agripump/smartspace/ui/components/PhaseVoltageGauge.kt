package com.agripump.smartspace.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun PhaseVoltageGauge(
    phaseLabel: String,
    voltage: Float,
    maxVoltage: Float = 500f,
    modifier: Modifier = Modifier
) {
    val sweepAngle = (voltage / maxVoltage) * 270f
    val arcColor = if (voltage == 0f) Color(0xFFF43F5E) else Color(0xFF38BDF8)

    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier.size(80.dp)
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            // Track background ring
            drawArc(
                color = Color(0xFF1E293B),
                startAngle = 135f,
                sweepAngle = 270f,
                useCenter = false,
                style = Stroke(width = 8.dp.toPx(), cap = StrokeCap.Round)
            )
            // Voltage sweep ring
            drawArc(
                color = arcColor,
                startAngle = 135f,
                sweepAngle = sweepAngle,
                useCenter = false,
                style = Stroke(width = 8.dp.toPx(), cap = StrokeCap.Round)
            )
        }

        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = "${voltage.toInt()}V",
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White
            )
            Text(
                text = phaseLabel,
                fontSize = 9.sp,
                color = Color(0xFF94A3B8)
            )
        }
    }
}
