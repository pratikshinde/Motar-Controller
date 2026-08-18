package com.example.pumpmonitor.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** Palette lifted from the web dashboard (dark navy + neon accents). */
object Neon {
    val Background = Color(0xFF070B12)
    val Card = Color(0xFF0C1424)
    val CardInner = Color(0xFF080E1A)
    val Border = Color(0xFF1B2A44)

    val Green = Color(0xFF00E676)
    val Cyan = Color(0xFF00E5FF)
    val Red = Color(0xFFFF4757)
    val Yellow = Color(0xFFFFC107)
    val Blue = Color(0xFF2E86F5)
    val Orange = Color(0xFFFFA000)

    val TextPrimary = Color(0xFFE6EDF7)
    val TextMuted = Color(0xFF7A8CA5)
}

/**
 * Per-phase colors, R/Y/B — the electrical convention SRS §6.1 and every
 * other surface (firmware LCD, web portal) uses. Deliberately distinct from
 * [Neon.Red] (fault/alert red) even though "R" stands for Red, so a faulted
 * R-phase reading doesn't visually collide with the fault banner color.
 */
object PhaseColors {
    val R = Color(0xFFFF7043)
    val Y = Color(0xFFFFC107)
    val B = Color(0xFF2E86F5)
}

/** Pump operational state colors — mirrors `pumps.status` (RUNNING/STOPPED/FAULT) plus a distinct OFFLINE (connectivity, not `status`). */
object StatusColors {
    val Running = Neon.Green
    val Stopped = Neon.TextMuted
    val Fault = Neon.Red
    val Offline = Neon.Orange
}

private val NeonColorScheme = darkColorScheme(
    background = Neon.Background,
    surface = Neon.Card,
    surfaceVariant = Neon.CardInner,
    primary = Neon.Green,
    secondary = Neon.Cyan,
    error = Neon.Red,
    onBackground = Neon.TextPrimary,
    onSurface = Neon.TextPrimary,
    onSurfaceVariant = Neon.TextMuted,
    outline = Neon.Border,
)

@Composable
fun PumpTheme(content: @Composable () -> Unit) {
    // Always dark — the neon design is dark-only, like the web UI.
    MaterialTheme(colorScheme = NeonColorScheme, content = content)
}
