package com.example.pumpmonitor.ui.dashboard

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import kotlinx.coroutines.delay

private object SapphireTheme {
    val Background = Color(0xFF070B14)
    val Surface = Color(0xFF0F172A)
    val SurfaceElevated = Color(0xFF1E293B)
    val Primary = Color(0xFF38BDF8)
    val AccentGreen = Color(0xFF10B981)
    val AccentRed = Color(0xFFF43F5E)
    val AccentAmber = Color(0xFFF59E0B)
    val TextMuted = Color(0xFF94A3B8)
    val BorderCard = Color(0x1AFFFFFF)
}

@Composable
fun DashboardScreen(vm: PumpViewModel, onBack: () -> Unit = {}) {
    val conn by vm.connectionState.collectAsState()
    val t by vm.telemetry.collectAsState()
    val pumpOn by vm.reportedPumpOn.collectAsState()
    val pending by vm.commandPending.collectAsState()
    val pump by vm.selectedPump.collectAsState()

    Column(
        Modifier
            .fillMaxSize()
            .background(SapphireTheme.Background)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // App Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = SapphireTheme.Primary
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = pump?.name ?: "Borewell Pump #1",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = Color.White
                )
                Text(
                    text = "3-Phase Power Health Monitor",
                    fontSize = 11.sp,
                    color = SapphireTheme.TextMuted
                )
            }
            Surface(
                shape = RoundedCornerShape(999.dp),
                color = if (pumpOn == true) Color(0x3310B981) else Color(0x3394A3B8)
            ) {
                Text(
                    text = if (pumpOn == true) "● RUNNING" else "● STOPPED",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (pumpOn == true) SapphireTheme.AccentGreen else SapphireTheme.TextMuted,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                )
            }
        }

        // 3-Phase Radial Rings Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = SapphireTheme.Surface),
            border = BorderStroke(1.dp, SapphireTheme.BorderCard)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "3-PHASE VOLTAGE MONITOR",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = SapphireTheme.Primary,
                    letterSpacing = 1.sp
                )
                Spacer(modifier = Modifier.height(14.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceAround
                ) {
                    RadialVoltageRing("Phase R-Y", t?.vRY ?: 418f)
                    RadialVoltageRing("Phase Y-B", t?.vYB ?: 422f)
                    RadialVoltageRing("Phase B-R", t?.vBR ?: 415f)
                }
            }
        }

        // Phase Currents Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = SapphireTheme.Surface),
            border = BorderStroke(1.dp, SapphireTheme.BorderCard)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "PHASE CURRENTS (AMPERES)",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = SapphireTheme.Primary,
                    letterSpacing = 1.sp
                )
                Spacer(modifier = Modifier.height(12.dp))
                CurrentProgressBar("Phase R", t?.iR ?: 14.2f, SapphireTheme.Primary)
                Spacer(modifier = Modifier.height(8.dp))
                CurrentProgressBar("Phase Y", t?.iY ?: 14.5f, SapphireTheme.AccentGreen)
                Spacer(modifier = Modifier.height(8.dp))
                CurrentProgressBar("Phase B", t?.iB ?: 14.1f, Color(0xFFA855F7))
            }
        }

        // 45s Cooldown Interlock Remote Power Switch
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = SapphireTheme.Surface),
            border = BorderStroke(1.dp, SapphireTheme.BorderCard)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = "REMOTE CONTACTOR SWITCH",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = SapphireTheme.Primary,
                    letterSpacing = 1.sp
                )
                Spacer(modifier = Modifier.height(16.dp))

                var cooldownSec by remember { mutableStateOf(0) }
                val isEnabled = cooldownSec == 0 && !pending

                LaunchedEffect(cooldownSec) {
                    if (cooldownSec > 0) {
                        delay(1000L)
                        cooldownSec--
                    }
                }

                val switchColor = if (pumpOn == true) SapphireTheme.AccentGreen else SapphireTheme.AccentRed

                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(110.dp)
                        .background(
                            Brush.radialGradient(listOf(switchColor.copy(alpha = 0.25f), Color.Transparent)),
                            CircleShape
                        )
                        .border(BorderStroke(3.dp, switchColor), CircleShape)
                        .clickable(enabled = isEnabled) {
                            cooldownSec = 45 // 45-second safety interlock
                            vm.setPump(pumpOn != true)
                        }
                ) {
                    Icon(
                        Icons.Filled.PowerSettingsNew,
                        contentDescription = "Toggle Contactor",
                        tint = switchColor,
                        modifier = Modifier.size(50.dp)
                    )
                }

                Spacer(modifier = Modifier.height(12.dp))

                if (cooldownSec > 0) {
                    Text(
                        text = "⏳ Cooldown Protection: ${cooldownSec}s",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = SapphireTheme.AccentAmber
                    )
                } else {
                    Text(
                        text = if (pumpOn == true) "CONTACTOR ENGAGED (PUMP ON)" else "CONTACTOR OPEN (PUMP OFF)",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = switchColor
                    )
                }
            }
        }
    }
}

@Composable
private fun RadialVoltageRing(label: String, voltage: Float) {
    val sweepAngle = (voltage / 500f) * 270f
    val color = if (voltage == 0f) SapphireTheme.AccentRed else SapphireTheme.Primary

    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier.size(86.dp)
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            drawArc(
                color = SapphireTheme.SurfaceElevated,
                startAngle = 135f,
                sweepAngle = 270f,
                useCenter = false,
                style = Stroke(width = 8.dp.toPx(), cap = StrokeCap.Round)
            )
            drawArc(
                color = color,
                startAngle = 135f,
                sweepAngle = sweepAngle,
                useCenter = false,
                style = Stroke(width = 8.dp.toPx(), cap = StrokeCap.Round)
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = "${voltage.toInt()}V",
                fontSize = 15.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Color.White
            )
            Text(
                text = label,
                fontSize = 9.sp,
                color = SapphireTheme.TextMuted
            )
        }
    }
}

@Composable
private fun CurrentProgressBar(label: String, amps: Float, color: Color) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = Color.White,
            modifier = Modifier.width(64.dp)
        )
        Box(
            modifier = Modifier
                .weight(1f)
                .height(10.dp)
                .background(SapphireTheme.SurfaceElevated, RoundedCornerShape(999.dp))
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction = (amps / 25f).coerceIn(0f, 1f))
                    .fillMaxHeight()
                    .background(color, RoundedCornerShape(999.dp))
            )
        }
        Text(
            text = "${"%.1f".format(amps)}A",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = Color.White,
            modifier = Modifier.padding(start = 10.dp)
        )
    }
}
