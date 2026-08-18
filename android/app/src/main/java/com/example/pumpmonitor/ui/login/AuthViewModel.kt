package com.example.pumpmonitor.ui.login

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.pumpmonitor.PumpApp
import com.example.pumpmonitor.data.auth.LoginOutcome
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

sealed interface AuthStep {
    data object EnterPhone : AuthStep
    data class EnterOtp(val phone: String, val devOtp: String? = null) : AuthStep
    data class EnterMfa(val mfaToken: String) : AuthStep
}

/**
 * Real backend OTP+MFA login (send-otp -> verify-otp -> [mfa/verify if the
 * account has TOTP enabled]) via [PumpApp.authRepository]. Replaces the
 * previous Firebase Phone Auth implementation — there is no demo-mode
 * bypass anymore, since the real backend is always reachable in dev too.
 */
class AuthViewModel(app: Application) : AndroidViewModel(app) {

    private val repo = (app as PumpApp).authRepository

    val signedIn: StateFlow<Boolean> = repo.signedIn
    val currentUser = repo.currentUser

    private val _step = MutableStateFlow<AuthStep>(AuthStep.EnterPhone)
    val step: StateFlow<AuthStep> = _step

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    private var lastPhone: String = ""

    /** "9876543210" -> "+919876543210"; full "+..." passes through. */
    fun normalizePhone(raw: String): String? {
        val s = raw.filter { !it.isWhitespace() && it != '-' }
        return when {
            s.startsWith("+") && s.drop(1).all { it.isDigit() } && s.length >= 11 -> s
            s.length == 10 && s.all { it.isDigit() } -> "+91$s"
            else -> null
        }
    }

    fun sendOtp(phone: String) {
        _error.value = null
        _busy.value = true
        lastPhone = phone
        viewModelScope.launch {
            repo.sendOtp(phone)
                .onSuccess { devOtp -> _step.value = AuthStep.EnterOtp(phone, devOtp) }
                .onFailure { _error.value = it.message }
            _busy.value = false
        }
    }

    fun resendOtp() {
        if (lastPhone.isNotEmpty()) sendOtp(lastPhone)
    }

    fun verifyOtp(code: String) {
        _error.value = null
        _busy.value = true
        viewModelScope.launch {
            when (val outcome = repo.verifyOtp(lastPhone, code)) {
                is LoginOutcome.Success -> Unit // signedIn flips via repo.signedIn, observed by the UI
                is LoginOutcome.MfaRequired -> _step.value = AuthStep.EnterMfa(outcome.mfaToken)
                is LoginOutcome.Error -> _error.value = outcome.message
            }
            _busy.value = false
        }
    }

    fun verifyMfaCode(code: String) {
        val mfaToken = (_step.value as? AuthStep.EnterMfa)?.mfaToken ?: return
        _error.value = null
        _busy.value = true
        viewModelScope.launch {
            when (val outcome = repo.verifyMfa(mfaToken, code)) {
                is LoginOutcome.Success -> Unit
                is LoginOutcome.MfaRequired -> _error.value = "Unexpected second MFA challenge"
                is LoginOutcome.Error -> _error.value = outcome.message
            }
            _busy.value = false
        }
    }

    fun signOut() {
        viewModelScope.launch { repo.signOut() }
        _step.value = AuthStep.EnterPhone
        _error.value = null
    }

    fun backToPhone() {
        _step.value = AuthStep.EnterPhone
        _error.value = null
    }
}
