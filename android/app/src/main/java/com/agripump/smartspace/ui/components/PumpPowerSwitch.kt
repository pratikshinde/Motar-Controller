package com.agripump.smartspace.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

@Composable
fun PumpPowerSwitch(
    pumpId: String,
    isRunning: Boolean,
    onToggle: (Boolean) -> Unit
) {
    var cooldownSec by remember { mutableStateOf(0) }
    val isEnabled = cooldownSec == 0

    LaunchedEffect(cooldownSec) {
        if (cooldownSec > 0) {
            delay(1000L)
            cooldownSec--
        }
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column {
            Text(
                text = "Remote Contactor Switch",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White
            )
            if (cooldownSec > 0) {
                Text(
                    text = "⏳ Cooldown: ${cooldownSec}s",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color(0xFFF59E0B)
                )
            }
        }

        Switch(
            checked = isRunning,
            enabled = isEnabled,
            onCheckedChange = { newState ->
                cooldownSec = 45 // Enforce 45s safety interlock
                onToggle(newState)
            },
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = Color(0xFF10B981),
                uncheckedTrackColor = Color(0xFF334155)
            )
        )
    }
}
