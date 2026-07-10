package com.example.pumpmonitor.ui.pumps

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.WaterDrop
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.pumpmonitor.R
import com.example.pumpmonitor.data.Pump
import com.example.pumpmonitor.ui.PumpViewModel
import com.example.pumpmonitor.ui.common.LanguageDialog
import com.example.pumpmonitor.ui.login.AuthViewModel
import com.example.pumpmonitor.ui.theme.Neon

@Composable
fun PumpsScreen(
    vm: PumpViewModel,
    authVm: AuthViewModel,
    onOpenPump: (Pump) -> Unit,
    onSignOut: () -> Unit,
) {
    val pumps by vm.pumps.collectAsState()
    val loading by vm.pumpsLoading.collectAsState()
    val error by vm.pumpsError.collectAsState()
    var showLanguages by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.loadPumps(authVm.userId) }
    if (showLanguages) LanguageDialog(onDismiss = { showLanguages = false })

    Column(
        Modifier
            .fillMaxSize()
            .background(Neon.Background)
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    stringResource(R.string.pumps_title).uppercase(),
                    fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold,
                    fontSize = 20.sp, letterSpacing = 2.sp, color = Neon.TextPrimary,
                )
                Text(
                    stringResource(R.string.pumps_subtitle),
                    color = Neon.TextMuted, fontSize = 12.sp,
                )
            }
            IconButton(onClick = { showLanguages = true }) {
                Icon(Icons.Filled.Language, stringResource(R.string.language), tint = Neon.Cyan)
            }
            IconButton(onClick = onSignOut) {
                Icon(
                    Icons.AutoMirrored.Filled.Logout,
                    stringResource(R.string.sign_out),
                    tint = Neon.Red,
                )
            }
        }
        Spacer(Modifier.height(16.dp))

        if (error != null) {
            Text(
                stringResource(R.string.pumps_error, error ?: ""),
                color = Neon.Yellow, fontSize = 12.sp,
                modifier = Modifier.padding(bottom = 12.dp),
            )
        }

        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Neon.Cyan)
            }

            pumps.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    stringResource(R.string.pumps_empty),
                    color = Neon.TextMuted, fontSize = 14.sp,
                    modifier = Modifier.padding(24.dp),
                )
            }

            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(pumps, key = { it.thingName }) { pump ->
                    PumpCard(pump, onClick = { onOpenPump(pump) })
                }
            }
        }
    }
}

@Composable
private fun PumpCard(pump: Pump, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = Neon.Card),
        border = BorderStroke(1.dp, Neon.Border),
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(48.dp)
                    .background(Neon.Green.copy(alpha = 0.12f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.WaterDrop, null, tint = Neon.Green, modifier = Modifier.size(26.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    pump.name,
                    fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold,
                    fontSize = 16.sp, color = Neon.TextPrimary,
                )
                if (pump.location.isNotBlank()) {
                    Text(pump.location, color = Neon.TextMuted, fontSize = 12.sp)
                }
                Text(
                    stringResource(R.string.pump_device_id, pump.thingName),
                    color = Neon.TextMuted, fontSize = 10.sp,
                    fontFamily = FontFamily.Monospace,
                )
            }
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                null, tint = Neon.Cyan, modifier = Modifier.size(28.dp),
            )
        }
    }
}
