package com.example.pumpmonitor.data.auth

import com.example.pumpmonitor.data.ApiError
import com.example.pumpmonitor.data.AuthUser
import com.example.pumpmonitor.data.LogoutRequest
import com.example.pumpmonitor.data.MfaVerifyRequest
import com.example.pumpmonitor.data.SendOtpRequest
import com.example.pumpmonitor.data.VerifyOtpRequest
import com.example.pumpmonitor.data.net.AuthApi
import com.google.gson.Gson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import retrofit2.Response

sealed interface LoginOutcome {
    data class Success(val user: AuthUser) : LoginOutcome
    data class MfaRequired(val mfaToken: String) : LoginOutcome
    data class Error(val message: String) : LoginOutcome
}

/**
 * Real backend OTP+MFA login (POST /api/auth/send-otp -> verify-otp ->
 * [mfa/verify if the account has TOTP enabled]), replacing the previous
 * Firebase Phone Auth implementation entirely. Session state is persisted
 * in [TokenStore] and mirrored here as StateFlow for the UI.
 */
class AuthRepository(
    private val tokenStore: TokenStore,
    private val authApi: AuthApi,
) {
    private val gson = Gson()

    private val _signedIn = MutableStateFlow(tokenStore.hasSession)
    val signedIn: StateFlow<Boolean> = _signedIn

    private val _currentUser = MutableStateFlow(tokenStore.user)
    val currentUser: StateFlow<AuthUser?> = _currentUser

    /** Returns the dev-mode OTP (present only when the backend runs with NODE_ENV=development). */
    suspend fun sendOtp(phone: String): Result<String?> = runCatching {
        val response = authApi.sendOtp(SendOtpRequest(phone))
        if (!response.isSuccessful) throw RuntimeException(parseError(response))
        response.body()?.devOtp
    }

    suspend fun verifyOtp(phone: String, code: String): LoginOutcome =
        handleLogin { authApi.verifyOtp(VerifyOtpRequest(phone, code)) }

    suspend fun verifyMfa(mfaToken: String, code: String): LoginOutcome =
        handleLogin { authApi.verifyMfa(MfaVerifyRequest(mfaToken, code)) }

    private suspend fun handleLogin(call: suspend () -> Response<com.example.pumpmonitor.data.AuthResult>): LoginOutcome {
        return try {
            val response = call()
            if (!response.isSuccessful) return LoginOutcome.Error(parseError(response))
            val result = response.body() ?: return LoginOutcome.Error("Empty response from server")

            if (result.mfaRequired) {
                val mfaToken = result.mfaToken ?: return LoginOutcome.Error("Malformed MFA challenge")
                return LoginOutcome.MfaRequired(mfaToken)
            }

            val token = result.token
            val refresh = result.refreshToken
            val user = result.user
            if (token == null || refresh == null || user == null) {
                return LoginOutcome.Error("Malformed login response")
            }
            tokenStore.saveSession(token, refresh, user)
            _signedIn.value = true
            _currentUser.value = user
            LoginOutcome.Success(user)
        } catch (e: Exception) {
            LoginOutcome.Error(e.message ?: "Network error — check your connection")
        }
    }

    /** Best-effort server-side revoke, then always clears the local session. */
    suspend fun signOut() {
        val refreshToken = tokenStore.refreshToken
        runCatching { authApi.logout(LogoutRequest(refreshToken)) }
        clearLocalSession()
    }

    /** Called by [com.example.pumpmonitor.data.net.ApiClient] when a refresh attempt fails outright. */
    fun onSessionExpired() {
        clearLocalSession()
    }

    private fun clearLocalSession() {
        tokenStore.clear()
        _signedIn.value = false
        _currentUser.value = null
    }

    private fun parseError(response: Response<*>): String {
        val raw = response.errorBody()?.string()
        val parsed = runCatching { gson.fromJson(raw, ApiError::class.java)?.error }.getOrNull()
        return parsed ?: "Request failed (HTTP ${response.code()})"
    }
}
