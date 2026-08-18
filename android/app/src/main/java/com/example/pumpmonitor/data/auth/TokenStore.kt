package com.example.pumpmonitor.data.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.example.pumpmonitor.data.AuthUser
import com.google.gson.Gson

/**
 * On-device storage for the access/refresh token pair and the signed-in
 * user, encrypted at rest (AES256-GCM via Jetpack Security's MasterKey).
 * Read synchronously — SharedPreferences is already loaded into memory by
 * the OS, so this is safe to call from [com.example.pumpmonitor.data.net.ApiClient]'s
 * OkHttp interceptor, which runs on a network thread and cannot suspend.
 */
class TokenStore(context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "pump_auth_secure",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    private val gson = Gson()

    var accessToken: String?
        get() = prefs.getString(KEY_ACCESS, null)
        set(value) = prefs.edit().putString(KEY_ACCESS, value).apply()

    var refreshToken: String?
        get() = prefs.getString(KEY_REFRESH, null)
        set(value) = prefs.edit().putString(KEY_REFRESH, value).apply()

    var user: AuthUser?
        get() = prefs.getString(KEY_USER, null)?.let {
            runCatching { gson.fromJson(it, AuthUser::class.java) }.getOrNull()
        }
        set(value) = prefs.edit().putString(KEY_USER, value?.let { gson.toJson(it) }).apply()

    /** True once a full sign-in has completed (both tokens present). */
    val hasSession: Boolean
        get() = accessToken != null && refreshToken != null

    fun saveSession(accessToken: String, refreshToken: String, user: AuthUser) {
        prefs.edit()
            .putString(KEY_ACCESS, accessToken)
            .putString(KEY_REFRESH, refreshToken)
            .putString(KEY_USER, gson.toJson(user))
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val KEY_ACCESS = "access_token"
        private const val KEY_REFRESH = "refresh_token"
        private const val KEY_USER = "user"
    }
}
