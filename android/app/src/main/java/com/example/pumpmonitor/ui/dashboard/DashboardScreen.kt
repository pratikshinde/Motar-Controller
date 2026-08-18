package com.example.pumpmonitor.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.SignalCellularAlt
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.pumpmonitor.R
import com.example.pumpmonitor.data.FaultLog
import com.example.pumpmonitor.data.Pump
import com.example.pumpmonitor.data.ws.WsConnectionState
import com.example.pumpmonitor.ui.PumpViewModel
import com.example.pumpmonitor.ui.common.LanguageDialog
import com.example.pumpmonitor.ui.theme.Neon
import com.example.pumpmonitor.ui.theme.PhaseColors
import com.example.pumpmonitor.ui.theme.StatusColors
import java.time.Duration
import java.time.Instant

private enum class DisplayStatus { RUNNING, STOPPED, FAULT, OFFLINE }

private fun parseInstant(iso: String?): Instant? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }

private fun relativeTime(instant: Instant?): String {
    if (instant == null) return "—"
    val seconds = Duration.between(instant, Instant.now()).seconds.coerceAtLeast(0)
    return when {
        seconds < 60 -> "${seconds}s"
        seconds < 3600 -> "${seconds / 60}m"
        seconds < 86400 -> "${seconds / 3600}h"
        else -> "${seconds / 86400}d"
    }
}

/**
 * The Pump screen — see docs/Android_App_Development_Plan.md §3.3/§3.4.
 * Structural fix for the below-fold control bug: the Command Bar sits
 * *outside* the scrollable middle section, so it is structurally incapable
 * of scrolling off-screen at any content height or screen size. Every value
 * shown here comes from a real backend field — no fallback literals.
 *
 * Two wireframe fields are deliberately omitted, not faked: a phase-sequence
 * correctness chip and total/cycle runtime. Neither has a backing column in
 * `agripump.telemetry_history` today (only `seq BIGINT`, an ordering field
 * of undocumented semantics, and no runtime accumulator at all) — see the
 * plan's B-2 finding. Fabricating them would repeat exactly the bug this
 * rewrite fixes elsewhere.
 */
@Composable
fun DashboardScreen(vm: PumpViewModel, onSignOut: () -> Unit) {
    val pump by vm.selectedPump.collectAsState()
    val pumps by vm.pumps.collectAsState()
    val wsState by vm.wsConnectionState.collectAsState()
    val openFaults by vm.openFaults.collectAsState()
    val commandBusy by vm.commandBusy.collectAsState()
    val commandCooldown by vm.commandCooldownRemaining.collectAsState()
    val commandError by vm.commandError.collectAsState()

    var showFaultSheet by remember { mutableStateOf(false) }
    var confirmingAction by remember { mutableStateOf<String?>(null) }
    var showLanguages by remember { mutableStateOf(false) }
    var showSwitcher by remember { mutableStateOf(false) }

    if (showLanguages) LanguageDialog(onDismiss = { showLanguages = false })
    if (showSwitcher && pumps.size > 1) {
        PumpSwitcherDialog(
            pumps = pumps,
            selectedId = pump?.id,
            onSelect = { vm.selectPump(it); showSwitcher = false },
            onDismiss = { showSwitcher = false },
        )
    }

    val p = pump
    if (p == null) {
        Box(Modifier.fillMaxSize().background(Neon.Background), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Neon.Cyan)
        }
        return
    }

    if (showFaultSheet) {
        FaultDetailSheet(
            faults = openFaults,
            onDismiss = { showFaultSheet = false },
            onResetFault = { fault -> vm.ackFault(fault); showFaultSheet = false },
        )
    }

    val lastSeen = parseInstant(p.lastSeenAt)
    val isOnline = lastSeen != null && Duration.between(lastSeen, Instant.now()).toMinutes() < 15
    val displayStatus = when {
        !isOnline -> DisplayStatus.OFFLINE
        p.status == "RUNNING" -> DisplayStatus.RUNNING
        p.status == "FAULT" -> DisplayStatus.FAULT
        else -> DisplayStatus.STOPPED
    }

    Column(Modifier.fillMaxSize().background(Neon.Background)) {
        TopStatusBar(
            pump = p,
            isOnline = isOnline,
            multiPump = pumps.size > 1,
            onSwitcherClick = { showSwitcher = true },
            onLanguageClick = { showLanguages = true },
            onSignOut = onSignOut,
        )

        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            if (openFaults.isNotEmpty()) {
                FaultBanner(fault = openFaults.first(), onClick = { showFaultSheet = true })
            }
            HeroStatus(displayStatus = displayStatus, lastSeen = lastSeen)
            PhaseGrid(p)
            StatusStrip(p, wsState)
        }

        CommandBar(
            pump = p,
            isOnline = isOnline,
            busy = commandBusy,
            cooldown = commandCooldown,
            error = commandError,
            confirming = confirmingAction,
            onRequestConfirm = { confirmingAction = it },
            onCancelConfirm = { confirmingAction = null },
            onConfirm = { action -> confirmingAction = null; vm.sendCommand(action) },
        )
    }
}

@Composable
private fun TopStatusBar(
    pump: Pump,
    isOnline: Boolean,
    multiPump: Boolean,
    onSwitcherClick: () -> Unit,
    onLanguageClick: () -> Unit,
    onSignOut: () -> Unit,
) {
    var showMenu by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().height(56.dp).background(Neon.Card).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            Modifier
                .weight(1f)
                .let { if (multiPump) it.clickable(onClick = onSwitcherClick) else it },
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    pump.name, color = Neon.TextPrimary, fontWeight = FontWeight.Bold,
                    fontSize = 16.sp, fontFamily = FontFamily.Monospace,
                )
                if (multiPump) {
                    Icon(Icons.Filled.SwapHoriz, null, tint = Neon.Cyan, modifier = Modifier.size(16.dp).padding(start = 4.dp))
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(8.dp).clip(CircleShape)
                        .background(if (isOnline) Neon.Green else Neon.Orange),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    if (isOnline) {
                        stringResource(R.string.pump_live_updated, relativeTime(parseInstant(pump.telemetryRecordedAt)))
                    } else {
                        stringResource(R.string.pump_offline_last_seen, relativeTime(parseInstant(pump.lastSeenAt)))
                    },
                    color = Neon.TextMuted, fontSize = 12.sp,
                )
            }
        }
        Box {
            IconButton(onClick = { showMenu = true }) {
                Icon(Icons.Filled.MoreVert, stringResource(R.string.menu), tint = Neon.Cyan)
            }
            DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.language)) },
                    leadingIcon = { Icon(Icons.Filled.Language, null) },
                    onClick = { showMenu = false; onLanguageClick() },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.sign_out)) },
                    leadingIcon = { Icon(Icons.AutoMirrored.Filled.Logout, null) },
                    onClick = { showMenu = false; onSignOut() },
                )
            }
        }
    }
}

@Composable
private fun FaultBanner(fault: FaultLog, onClick: () -> Unit) {
    val color = when (fault.severity) {
        "CRITICAL", "HIGH" -> Neon.Red
        else -> Neon.Yellow
    }
    Row(
        Modifier
            .fillMaxWidth()
            .background(color.copy(alpha = 0.12f))
            .clickable(onClick = onClick)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Warning, null, tint = color)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                (fault.faultName ?: stringResource(R.string.fault_unknown)).uppercase(),
                color = color, fontWeight = FontWeight.Bold, fontSize = 14.sp,
            )
            Text(
                fault.description ?: stringResource(R.string.fault_tap_for_action),
                color = Neon.TextMuted, fontSize = 12.sp, maxLines = 1,
            )
        }
        Icon(Icons.Filled.ChevronRight, null, tint = Neon.TextMuted)
    }
}

@Composable
private fun HeroStatus(displayStatus: DisplayStatus, lastSeen: Instant?) {
    val (label, color) = when (displayStatus) {
        DisplayStatus.RUNNING -> stringResource(R.string.status_running) to StatusColors.Running
        DisplayStatus.STOPPED -> stringResource(R.string.status_stopped) to StatusColors.Stopped
        DisplayStatus.FAULT -> stringResource(R.string.status_fault) to StatusColors.Fault
        DisplayStatus.OFFLINE -> stringResource(R.string.status_disconnected) to StatusColors.Offline
    }
    Column(
        Modifier
            .fillMaxWidth()
            .height(132.dp)
            .background(color.copy(alpha = 0.10f)),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            label, color = color, fontWeight = FontWeight.Black,
            fontSize = 34.sp, letterSpacing = 3.sp, fontFamily = FontFamily.Monospace,
        )
        if (lastSeen != null) {
            Spacer(Modifier.height(6.dp))
            Text(
                stringResource(R.string.pump_updated_ago, relativeTime(lastSeen)),
                color = Neon.TextMuted, fontSize = 12.sp,
            )
        }
    }
}

@Composable
private fun PhaseGrid(pump: Pump) {
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        Text(stringResource(R.string.card_line_voltages), color = Neon.TextMuted, fontSize = 11.sp, letterSpacing = 1.sp)
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PhaseCell(Modifier.weight(1f), "R-Y", pump.vRyVolts, "V", PhaseColors.R, 500f)
            PhaseCell(Modifier.weight(1f), "Y-B", pump.vYbVolts, "V", PhaseColors.Y, 500f)
            PhaseCell(Modifier.weight(1f), "B-R", pump.vBrVolts, "V", PhaseColors.B, 500f)
        }
        Spacer(Modifier.height(14.dp))
        Text(stringResource(R.string.card_phase_currents), color = Neon.TextMuted, fontSize = 11.sp, letterSpacing = 1.sp)
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PhaseCell(Modifier.weight(1f), "R", pump.iRAmps, "A", PhaseColors.R, 30f)
            PhaseCell(Modifier.weight(1f), "Y", pump.iYAmps, "A", PhaseColors.Y, 30f)
            PhaseCell(Modifier.weight(1f), "B", pump.iBAmps, "A", PhaseColors.B, 30f)
        }
    }
}

@Composable
private fun PhaseCell(modifier: Modifier, label: String, value: Float?, unit: String, color: Color, scaleMax: Float) {
    Column(
        modifier
            .background(Neon.Card, RoundedCornerShape(10.dp))
            .padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(label, color = Neon.TextMuted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
        Text(
            if (value != null) "${"%.1f".format(value)}" else "—",
            color = if (value != null) Neon.TextPrimary else Neon.TextMuted,
            fontWeight = FontWeight.Bold, fontSize = 15.sp, fontFamily = FontFamily.Monospace,
        )
        if (value != null) Text(unit, color = Neon.TextMuted, fontSize = 9.sp)
        Spacer(Modifier.height(4.dp))
        Box(Modifier.fillMaxWidth().height(4.dp).background(Neon.CardInner, RoundedCornerShape(2.dp))) {
            if (value != null) {
                Box(
                    Modifier
                        .fillMaxWidth((value / scaleMax).coerceIn(0f, 1f))
                        .height(4.dp)
                        .background(color, RoundedCornerShape(2.dp)),
                )
            }
        }
    }
}

@Composable
private fun StatusStrip(pump: Pump, wsState: WsConnectionState) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        pump.gsmRssi?.let { Chip(Icons.Filled.SignalCellularAlt, "$it dBm") }
        Chip(
            if (pump.buffered == true) Icons.Filled.Warning else Icons.Filled.CheckCircle,
            stringResource(if (pump.buffered == true) R.string.data_buffered else R.string.data_live),
        )
        pump.firmwareVersion?.let { Chip(null, "FW $it") }
        if (wsState != WsConnectionState.CONNECTED) {
            Chip(Icons.Filled.Warning, stringResource(R.string.ws_reconnecting))
        }
    }
}

@Composable
private fun Chip(icon: androidx.compose.ui.graphics.vector.ImageVector?, text: String) {
    Row(
        Modifier.background(Neon.CardInner, RoundedCornerShape(20.dp)).padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, null, tint = Neon.TextMuted, modifier = Modifier.size(13.dp))
            Spacer(Modifier.width(4.dp))
        }
        Text(text, color = Neon.TextMuted, fontSize = 11.sp)
    }
}

@Composable
private fun CommandBar(
    pump: Pump,
    isOnline: Boolean,
    busy: Boolean,
    cooldown: Int,
    error: String?,
    confirming: String?,
    onRequestConfirm: (String) -> Unit,
    onCancelConfirm: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    val isOn = pump.status == "RUNNING"
    Column(
        Modifier.fillMaxWidth().background(Neon.Card).padding(16.dp),
    ) {
        if (error != null) {
            Text(error, color = Neon.Red, fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp))
        }
        when {
            confirming != null -> {
                Text(
                    stringResource(
                        if (confirming == "START") R.string.confirm_start else R.string.confirm_stop,
                        pump.name,
                    ),
                    color = Neon.TextPrimary, fontSize = 14.sp, modifier = Modifier.padding(bottom = 10.dp),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    TextButton(onClick = onCancelConfirm, modifier = Modifier.weight(1f)) {
                        Text(stringResource(R.string.cancel))
                    }
                    Button(
                        onClick = { onConfirm(confirming) },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (confirming == "START") Neon.Green else Neon.Red,
                        ),
                    ) {
                        Text(stringResource(if (confirming == "START") R.string.start_pump else R.string.stop_pump))
                    }
                }
            }

            !isOnline -> {
                CommandBarButton(
                    text = stringResource(R.string.command_offline_notice),
                    color = Neon.TextMuted, enabled = false, onClick = {},
                )
            }

            cooldown > 0 -> {
                LinearProgressIndicator(
                    progress = { (cooldown.toFloat() / 45f).coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                    color = Neon.Cyan, trackColor = Neon.CardInner,
                )
                CommandBarButton(
                    text = stringResource(R.string.command_cooldown, cooldown),
                    color = Neon.TextMuted, enabled = false, onClick = {},
                )
            }

            busy -> {
                CommandBarButton(text = stringResource(R.string.command_sending), color = Neon.Cyan, enabled = false, onClick = {}, busy = true)
            }

            else -> {
                CommandBarButton(
                    text = stringResource(if (isOn) R.string.tap_to_stop else R.string.tap_to_start),
                    color = if (isOn) Neon.Red else Neon.Green,
                    enabled = true,
                    onClick = { onRequestConfirm(if (isOn) "STOP" else "START") },
                )
            }
        }
    }
}

@Composable
private fun CommandBarButton(text: String, color: Color, enabled: Boolean, busy: Boolean = false, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(
            containerColor = color.copy(alpha = 0.15f),
            contentColor = color,
            disabledContainerColor = color.copy(alpha = 0.10f),
            disabledContentColor = color,
        ),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth().height(56.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = color)
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.PowerSettingsNew, null, tint = color)
                Spacer(Modifier.width(8.dp))
                Text(text, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, fontFamily = FontFamily.Monospace)
            }
        }
    }
}

@Composable
private fun PumpSwitcherDialog(pumps: List<Pump>, selectedId: String?, onSelect: (String) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Neon.Card,
        titleContentColor = Neon.TextPrimary,
        title = { Text(stringResource(R.string.pump_switcher_title)) },
        text = {
            Column {
                pumps.forEach { p ->
                    Row(
                        Modifier.fillMaxWidth().clickable { onSelect(p.id) }.padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier.size(8.dp).clip(CircleShape)
                                .background(if (p.id == selectedId) Neon.Cyan else Neon.Border),
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(p.name, color = Neon.TextPrimary)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun FaultDetailSheet(faults: List<FaultLog>, onDismiss: () -> Unit, onResetFault: (FaultLog) -> Unit) {
    val sheetState = rememberModalBottomSheetState()
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Neon.Card) {
        Column(Modifier.padding(20.dp)) {
            Text(stringResource(R.string.card_faults), color = Neon.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Spacer(Modifier.height(12.dp))
            faults.forEach { fault ->
                Column(Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
                    Text(
                        (fault.faultName ?: stringResource(R.string.fault_unknown)).uppercase(),
                        color = Neon.Red, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                    )
                    fault.description?.let { Text(it, color = Neon.TextPrimary, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp)) }
                    Spacer(Modifier.height(8.dp))
                    TextButton(onClick = { onResetFault(fault) }) {
                        Text(stringResource(R.string.reset_fault), color = Neon.Cyan)
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}
