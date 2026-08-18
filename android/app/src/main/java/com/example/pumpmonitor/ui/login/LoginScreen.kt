package com.example.pumpmonitor.ui.login

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.WaterDrop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.pumpmonitor.R
import com.example.pumpmonitor.ui.common.LanguageDialog
import com.example.pumpmonitor.ui.theme.Neon

@Composable
fun LoginScreen(vm: AuthViewModel, onSignedIn: () -> Unit) {
    val step by vm.step.collectAsState()
    val busy by vm.busy.collectAsState()
    val error by vm.error.collectAsState()
    val signedIn by vm.signedIn.collectAsState()

    var phone by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var localError by remember { mutableStateOf<Int?>(null) }
    var showLanguages by remember { mutableStateOf(false) }

    LaunchedEffect(signedIn) { if (signedIn) onSignedIn() }
    LaunchedEffect(step) { code = "" }
    if (showLanguages) LanguageDialog(onDismiss = { showLanguages = false })

    Column(
        Modifier
            .fillMaxSize()
            .background(Neon.Background)
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            IconButton(onClick = { showLanguages = true }) {
                Icon(Icons.Filled.Language, stringResource(R.string.language), tint = Neon.Cyan)
            }
        }
        Spacer(Modifier.height(36.dp))

        Box(
            Modifier
                .size(84.dp)
                .background(Neon.Green.copy(alpha = 0.12f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.WaterDrop, null, tint = Neon.Green, modifier = Modifier.size(44.dp))
        }
        Spacer(Modifier.height(18.dp))
        Text(
            stringResource(R.string.app_name).uppercase(),
            fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold,
            fontSize = 24.sp, letterSpacing = 3.sp, color = Neon.TextPrimary,
        )
        Text(
            stringResource(R.string.login_subtitle),
            color = Neon.TextMuted, fontSize = 13.sp,
            modifier = Modifier.padding(top = 6.dp),
        )
        Spacer(Modifier.height(36.dp))

        when (val s = step) {
            is AuthStep.EnterPhone -> {
                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it; localError = null },
                    label = { Text(stringResource(R.string.login_phone_label)) },
                    prefix = { Text("+91 ", color = Neon.TextMuted) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    colors = neonFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(16.dp))
                NeonButton(
                    text = stringResource(R.string.login_send_otp),
                    enabled = !busy, busy = busy,
                    onClick = {
                        val normalized = vm.normalizePhone(phone)
                        if (normalized == null) {
                            localError = R.string.login_invalid_phone
                        } else {
                            vm.sendOtp(normalized)
                        }
                    },
                )
            }

            is AuthStep.EnterOtp -> {
                Text(
                    stringResource(R.string.login_otp_sent, s.phone),
                    color = Neon.TextMuted, fontSize = 13.sp,
                )
                if (s.devOtp != null) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        stringResource(R.string.login_dev_otp_hint, s.devOtp),
                        color = Neon.Yellow, fontSize = 12.sp,
                    )
                }
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = code,
                    onValueChange = { if (it.length <= 6) code = it; localError = null },
                    label = { Text(stringResource(R.string.login_otp_label)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    colors = neonFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(16.dp))
                NeonButton(
                    text = stringResource(R.string.login_verify),
                    enabled = !busy, busy = busy,
                    onClick = {
                        if (code.length != 6) localError = R.string.login_invalid_otp
                        else vm.verifyOtp(code)
                    },
                )
                Row {
                    TextButton(onClick = { vm.resendOtp() }) {
                        Text(stringResource(R.string.login_resend), color = Neon.Cyan)
                    }
                    TextButton(onClick = { code = ""; vm.backToPhone() }) {
                        Text(stringResource(R.string.login_change_number), color = Neon.TextMuted)
                    }
                }
            }

            is AuthStep.EnterMfa -> {
                Text(
                    stringResource(R.string.login_mfa_label),
                    color = Neon.TextMuted, fontSize = 13.sp,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = code,
                    onValueChange = { if (it.length <= 6) code = it; localError = null },
                    label = { Text(stringResource(R.string.login_mfa_code_label)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    colors = neonFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(16.dp))
                NeonButton(
                    text = stringResource(R.string.login_verify),
                    enabled = !busy, busy = busy,
                    onClick = {
                        if (code.length != 6) localError = R.string.login_invalid_otp
                        else vm.verifyMfaCode(code)
                    },
                )
                TextButton(onClick = { code = ""; vm.backToPhone() }) {
                    Text(stringResource(R.string.login_change_number), color = Neon.TextMuted)
                }
            }
        }

        val errorText = localError?.let { stringResource(it) } ?: error
        if (errorText != null) {
            Spacer(Modifier.height(14.dp))
            Text(errorText, color = Neon.Red, fontSize = 13.sp)
        }
    }
}

@Composable
private fun NeonButton(text: String, enabled: Boolean, busy: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(
            containerColor = Neon.Green.copy(alpha = 0.15f),
            contentColor = Neon.Green,
            disabledContainerColor = Neon.CardInner,
            disabledContentColor = Neon.TextMuted,
        ),
        border = BorderStroke(1.dp, Neon.Green),
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.fillMaxWidth().height(50.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Neon.Green)
        } else {
            Text(
                text, fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold, letterSpacing = 2.sp,
            )
        }
    }
}

@Composable
private fun neonFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Neon.Cyan,
    unfocusedBorderColor = Neon.Border,
    focusedLabelColor = Neon.Cyan,
    unfocusedLabelColor = Neon.TextMuted,
    focusedTextColor = Neon.TextPrimary,
    unfocusedTextColor = Neon.TextPrimary,
    cursorColor = Neon.Cyan,
)
