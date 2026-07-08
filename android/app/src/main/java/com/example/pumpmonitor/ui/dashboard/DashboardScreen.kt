package com.example.pumpmonitor.ui.dashboard

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.pumpmonitor.aws.ConnectionState
import com.example.pumpmonitor.data.Telemetry
import com.example.pumpmonitor.ui.PumpViewModel
import com.example.pumpmonitor.ui.theme.Neon

@Composable
fun DashboardScreen(vm: PumpViewModel) {
    val conn by vm.connectionState.collectAsState()
    val t by vm.telemetry.collectAsState()
    val pumpOn by vm.reportedPumpOn.collectAsState()
    val pending by vm.commandPending.collectAsState()

    Column(
        Modifier
            .fillMaxSize()
            .background(Neon.Background)
            .verticalScroll(rememberScrollState())
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        HeaderCard(conn, running = pumpOn == true, gsmRssi = t?.gsmRssi)
        LineVoltagesCard(t)
        PhaseCurrentsCard(t)
        PhaseSequenceCard(reverse = t?.seqReverse == true, hasData = t != null)
        RunTimeCard(t)
        PumpControlCard(pumpOn = pumpOn, pending = pending, onToggle = vm::setPump)
        FaultsCard(t?.faults ?: emptyList())
    }
}

/* ---------------------------------------------------------- header */

@Composable
private fun HeaderCard(conn: ConnectionState, running: Boolean, gsmRssi: Int?) {
    NeonCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    "PUMP MONITOR",
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    letterSpacing = 2.sp,
                )
                Text(
                    "3-PHASE 440V SYSTEM",
                    color = Neon.TextMuted,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    letterSpacing = 2.sp,
                )
            }
            StatusPill(
                label = when {
                    conn != ConnectionState.CONNECTED -> conn.name
                    running -> "RUNNING"
                    else -> "STOPPED"
                },
                color = when {
                    conn != ConnectionState.CONNECTED -> Neon.Yellow
                    running -> Neon.Green
                    else -> Neon.Red
                },
            )
            Spacer(Modifier.width(12.dp))
            GsmBars(rssi = gsmRssi ?: 0)
        }
    }
}

@Composable
private fun StatusPill(label: String, color: Color) {
    Row(
        Modifier
            .border(BorderStroke(1.dp, color), RoundedCornerShape(50))
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(8.dp).background(color, CircleShape))
        Text(
            "  $label",
            color = color,
            fontFamily = FontFamily.Monospace,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.sp,
        )
    }
}

@Composable
private fun GsmBars(rssi: Int) {
    // AT+CSQ style: 0..31, 99 = unknown
    val bars = when {
        rssi in 1..7 -> 1; rssi in 8..14 -> 2; rssi in 15..21 -> 3
        rssi in 22..31 -> 4; else -> 0
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            repeat(4) { i ->
                Box(
                    Modifier
                        .width(4.dp)
                        .height((6 + i * 4).dp)
                        .background(
                            if (i < bars) Neon.Green else Neon.Border,
                            RoundedCornerShape(1.dp),
                        ),
                )
            }
        }
        Text("GSM", color = Neon.TextMuted, fontSize = 8.sp,
            fontFamily = FontFamily.Monospace, letterSpacing = 1.sp)
    }
}

/* ------------------------------------------------- line voltages */

@Composable
private fun LineVoltagesCard(t: Telemetry?) {
    NeonCard {
        SectionTitle("⚡ LINE VOLTAGES (440V)")
        Row(
            Modifier.fillMaxWidth().padding(top = 12.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            VoltageRing("RY", t?.vRY, t?.pRY, Neon.Red)
            VoltageRing("YB", t?.vYB, t?.pYB, Neon.Yellow)
            VoltageRing("BR", t?.vBR, t?.pBR, Neon.Blue)
        }
    }
}

@Composable
private fun VoltageRing(label: String, volts: Float?, present: Boolean?, color: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.size(96.dp)) {
            Canvas(Modifier.fillMaxSize()) {
                val stroke = Stroke(width = 10f, cap = StrokeCap.Round)
                // Track
                drawArc(
                    color = Neon.Border, startAngle = -90f, sweepAngle = 360f,
                    useCenter = false, style = stroke,
                )
                // Value arc: 0V..480V mapped to full circle
                val sweep = ((volts ?: 0f) / 480f).coerceIn(0f, 1f) * 360f
                drawArc(
                    brush = Brush.sweepGradient(listOf(color.copy(alpha = 0.35f), color)),
                    startAngle = -90f, sweepAngle = sweep,
                    useCenter = false, style = stroke,
                )
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(label, color = color, fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold, fontSize = 13.sp)
                Text(
                    volts?.let { "%.1f".format(it) } ?: "--",
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold, fontSize = 17.sp,
                )
                Text("Volts", color = Neon.TextMuted, fontSize = 9.sp,
                    fontFamily = FontFamily.Monospace)
            }
        }
        Spacer(Modifier.height(6.dp))
        val ok = present == true
        Text(
            if (ok) "PRESENT" else "MISSING",
            color = if (ok) Neon.Green else Neon.Red,
            fontFamily = FontFamily.Monospace, fontSize = 10.sp,
            fontWeight = FontWeight.Bold, letterSpacing = 1.sp,
            modifier = Modifier
                .background(
                    (if (ok) Neon.Green else Neon.Red).copy(alpha = 0.12f),
                    RoundedCornerShape(4.dp),
                )
                .padding(horizontal = 8.dp, vertical = 2.dp),
        )
    }
}

/* ------------------------------------------------ phase currents */

private const val MAX_CURRENT_A = 15f  // full-scale for the bars; set to your CT rating

@Composable
private fun PhaseCurrentsCard(t: Telemetry?) {
    NeonCard {
        SectionTitle("~ PHASE CURRENTS")
        Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            CurrentBar("R", t?.iR, Neon.Red)
            CurrentBar("Y", t?.iY, Neon.Yellow)
            CurrentBar("B", t?.iB, Neon.Blue)
        }
    }
}

@Composable
private fun CurrentBar(phase: String, amps: Float?, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            phase, color = color, fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold, fontSize = 13.sp,
            modifier = Modifier
                .background(color.copy(alpha = 0.15f), RoundedCornerShape(4.dp))
                .border(BorderStroke(1.dp, color.copy(alpha = 0.5f)), RoundedCornerShape(4.dp))
                .padding(horizontal = 8.dp, vertical = 4.dp),
        )
        Spacer(Modifier.width(10.dp))
        Box(
            Modifier
                .weight(1f)
                .height(24.dp)
                .background(Neon.CardInner, RoundedCornerShape(4.dp)),
        ) {
            val frac = ((amps ?: 0f) / MAX_CURRENT_A).coerceIn(0f, 1f)
            Box(
                Modifier
                    .fillMaxWidth(frac)
                    .height(24.dp)
                    .background(
                        Brush.horizontalGradient(listOf(color.copy(alpha = 0.55f), color)),
                        RoundedCornerShape(4.dp),
                    ),
            )
            Text(
                amps?.let { "%.1f A".format(it) } ?: "--",
                fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold,
                fontSize = 12.sp, color = Neon.TextPrimary,
                modifier = Modifier.align(Alignment.CenterStart).padding(start = 10.dp),
            )
        }
        Text("  A", color = Neon.TextMuted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
    }
}

/* ------------------------------------------------ phase sequence */

@Composable
private fun PhaseSequenceCard(reverse: Boolean, hasData: Boolean) {
    NeonCard {
        SectionTitle("⟳ PHASE SEQUENCE")
        Column(
            Modifier.fillMaxWidth().padding(top = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("R", color = Neon.Red, fontSize = 24.sp,
                    fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                Text(" → ", color = Neon.TextMuted, fontSize = 20.sp)
                Text("Y", color = Neon.Yellow, fontSize = 24.sp,
                    fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                Text(" → ", color = Neon.TextMuted, fontSize = 20.sp)
                Text("B", color = Neon.Blue, fontSize = 24.sp,
                    fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
            }
            val (label, color) = when {
                !hasData -> "NO DATA" to Neon.TextMuted
                reverse -> "✕ REVERSE" to Neon.Red
                else -> "✓ CORRECT" to Neon.Green
            }
            Text(
                label, color = color, fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold, letterSpacing = 2.sp, fontSize = 14.sp,
                modifier = Modifier
                    .border(BorderStroke(1.dp, color), RoundedCornerShape(8.dp))
                    .background(color.copy(alpha = 0.10f), RoundedCornerShape(8.dp))
                    .padding(horizontal = 20.dp, vertical = 8.dp),
            )
        }
    }
}

/* ------------------------------------------------------ run time */

private fun formatHms(totalSec: Long): String {
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    val s = totalSec % 60
    return "%03d:%02d:%02d".format(h, m, s)
}

@Composable
private fun RunTimeCard(t: Telemetry?) {
    NeonCard {
        SectionTitle("◷ RUN TIME")
        Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            RunTimeRow("TOTAL RUN TIME", t?.totalRunSec, Neon.Cyan)
            RunTimeRow("LAST CYCLE RUN TIME", t?.lastCycleRunSec, Neon.Orange)
        }
    }
}

@Composable
private fun RunTimeRow(label: String, sec: Long?, color: Color) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Neon.CardInner, RoundedCornerShape(6.dp)),
    ) {
        Box(Modifier.width(4.dp).height(76.dp).background(color, RoundedCornerShape(2.dp)))
        Column(Modifier.padding(12.dp)) {
            Text(label, color = Neon.TextMuted, fontSize = 10.sp,
                fontFamily = FontFamily.Monospace, letterSpacing = 2.sp)
            Text(
                sec?.let { formatHms(it) } ?: "---:--:--",
                color = color, fontSize = 26.sp, fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
            )
            Text("Hours : Minutes : Seconds", color = Neon.TextMuted,
                fontSize = 10.sp, fontFamily = FontFamily.Monospace)
        }
    }
}

/* -------------------------------------------------- pump control */

@Composable
private fun PumpControlCard(pumpOn: Boolean?, pending: Boolean, onToggle: (Boolean) -> Unit) {
    val on = pumpOn == true
    val color = when {
        pumpOn == null -> Neon.TextMuted
        on -> Neon.Green
        else -> Neon.Red
    }
    NeonCard {
        SectionTitle("⏻ PUMP CONTROL")
        Column(
            Modifier.fillMaxWidth().padding(top = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // Glowing power button
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(130.dp)
                    .background(
                        Brush.radialGradient(
                            listOf(color.copy(alpha = 0.25f), Color.Transparent),
                        ),
                        CircleShape,
                    )
                    .border(BorderStroke(3.dp, color), CircleShape)
                    .clickable(enabled = !pending && pumpOn != null) { onToggle(!on) },
            ) {
                Icon(
                    Icons.Filled.PowerSettingsNew,
                    contentDescription = if (on) "Stop pump" else "Start pump",
                    tint = color,
                    modifier = Modifier.size(56.dp),
                )
            }
            if (pending) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = Neon.Yellow)
                    Text("  WAITING FOR PUMP...", color = Neon.Yellow, fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace, letterSpacing = 1.sp)
                }
            } else {
                Text(
                    when (pumpOn) { true -> "ON"; false -> "OFF"; null -> "UNKNOWN" },
                    color = color, fontSize = 20.sp, fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace, letterSpacing = 4.sp,
                )
            }
            Text(
                "Tap to toggle • command goes via Device Shadow",
                color = Neon.TextMuted, fontSize = 10.sp, fontFamily = FontFamily.Monospace,
            )
        }
    }
}

/* -------------------------------------------------------- faults */

@Composable
private fun FaultsCard(faults: List<String>) {
    NeonCard {
        SectionTitle("⚠ PUMP FAULTS")
        if (faults.isEmpty()) {
            Box(Modifier.fillMaxWidth().padding(vertical = 24.dp), contentAlignment = Alignment.Center) {
                Text("ALL CLEAR", color = Neon.Cyan, fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold, letterSpacing = 3.sp)
            }
        } else {
            Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                faults.forEach { fault ->
                    Text(
                        "✕ $fault",
                        color = Neon.Red, fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold, fontSize = 13.sp,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Neon.Red.copy(alpha = 0.10f), RoundedCornerShape(6.dp))
                            .border(BorderStroke(1.dp, Neon.Red.copy(alpha = 0.4f)), RoundedCornerShape(6.dp))
                            .padding(12.dp),
                    )
                }
            }
        }
    }
}

/* ------------------------------------------------------- shared */

@Composable
private fun NeonCard(content: @Composable () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Neon.Card),
        border = BorderStroke(1.dp, Neon.Border),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(Modifier.padding(16.dp)) { content() }
    }
}

@Composable
private fun SectionTitle(title: String) {
    Column {
        Text(
            title, color = Neon.TextMuted, fontFamily = FontFamily.Monospace,
            fontSize = 12.sp, letterSpacing = 3.sp, fontWeight = FontWeight.Bold,
        )
        HorizontalDivider(Modifier.padding(top = 8.dp), color = Neon.Border)
    }
}
