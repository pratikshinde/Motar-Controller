package com.example.pumpmonitor.ui.login

import android.app.Activity
import android.app.Application
import androidx.lifecycle.AndroidViewModel
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.PhoneAuthCredential
import com.google.firebase.auth.PhoneAuthOptions
import com.google.firebase.auth.PhoneAuthProvider
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.concurrent.TimeUnit

sealed interface AuthStep {
    data object EnterPhone : AuthStep
    data class EnterOtp(val phone: String) : AuthStep
}

/**
 * Phone-number OTP login via Firebase Authentication (Phone provider).
 * The Firebase session persists across app restarts, so users sign in once.
 *
 * Until google-services.json is added, [firebaseAvailable] is false and the
 * login screen offers a demo-mode bypass instead of OTP.
 */
class AuthViewModel(app: Application) : AndroidViewModel(app) {

    val firebaseAvailable: Boolean = FirebaseApp.getApps(app).isNotEmpty()

    private val auth: FirebaseAuth? =
        if (firebaseAvailable) FirebaseAuth.getInstance() else null

    private val _signedIn = MutableStateFlow(auth?.currentUser != null)
    val signedIn: StateFlow<Boolean> = _signedIn

    private val _step = MutableStateFlow<AuthStep>(AuthStep.EnterPhone)
    val step: StateFlow<AuthStep> = _step

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    private var verificationId: String? = null
    private var resendToken: PhoneAuthProvider.ForceResendingToken? = null
    private var lastPhone: String = ""

    /** Signed-in user's phone in E.164 — the pumps-API user id. */
    val userId: String
        get() = auth?.currentUser?.phoneNumber ?: "demo"

    /** "9876543210" -> "+919876543210"; full "+..." passes through. */
    fun normalizePhone(raw: String): String? {
        val s = raw.filter { !it.isWhitespace() && it != '-' }
        return when {
            s.startsWith("+") && s.drop(1).all { it.isDigit() } && s.length >= 11 -> s
            s.length == 10 && s.all { it.isDigit() } -> "+91$s"
            else -> null
        }
    }

    private val callbacks = object : PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
        override fun onVerificationCompleted(credential: PhoneAuthCredential) {
            // Instant verification / SMS auto-retrieval — no typing needed.
            signIn(credential)
        }

        override fun onVerificationFailed(e: FirebaseException) {
            _busy.value = false
            _error.value = e.localizedMessage ?: e.javaClass.simpleName
        }

        override fun onCodeSent(id: String, token: PhoneAuthProvider.ForceResendingToken) {
            _busy.value = false
            verificationId = id
            resendToken = token
            _step.value = AuthStep.EnterOtp(lastPhone)
        }
    }

    fun sendOtp(phone: String, activity: Activity, resend: Boolean = false) {
        val fb = auth ?: return
        _error.value = null
        _busy.value = true
        lastPhone = phone
        val builder = PhoneAuthOptions.newBuilder(fb)
            .setPhoneNumber(phone)
            .setTimeout(60L, TimeUnit.SECONDS)
            .setActivity(activity)
            .setCallbacks(callbacks)
        if (resend) resendToken?.let { builder.setForceResendingToken(it) }
        PhoneAuthProvider.verifyPhoneNumber(builder.build())
    }

    fun verifyOtp(code: String) {
        val id = verificationId ?: return
        signIn(PhoneAuthProvider.getCredential(id, code))
    }

    private fun signIn(credential: PhoneAuthCredential) {
        val fb = auth ?: return
        _error.value = null
        _busy.value = true
        fb.signInWithCredential(credential)
            .addOnSuccessListener {
                _busy.value = false
                _signedIn.value = true
            }
            .addOnFailureListener {
                _busy.value = false
                _error.value = it.localizedMessage ?: it.javaClass.simpleName
            }
    }

    /** Only offered while Firebase isn't configured (session-only). */
    fun continueInDemoMode() {
        _signedIn.value = true
    }

    fun signOut() {
        auth?.signOut()
        _signedIn.value = false
        _step.value = AuthStep.EnterPhone
        _error.value = null
    }

    fun backToPhone() {
        _step.value = AuthStep.EnterPhone
        _error.value = null
    }
}
