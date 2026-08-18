package com.example.pumpmonitor.data.net

import com.example.pumpmonitor.data.AppConfig
import com.example.pumpmonitor.data.AuthResult
import com.example.pumpmonitor.data.RefreshRequest
import com.example.pumpmonitor.data.auth.TokenStore
import com.google.gson.Gson
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

/**
 * The single OkHttp/Retrofit stack the app uses to talk to backend/server.js.
 * Every request carries the current access token (FR-CLD-041 — 15 min TTL);
 * a 401 triggers a single-flight refresh (POST /api/auth/refresh) via an
 * [Authenticator] and a retry of the original request. A failed refresh
 * clears the session and calls [onSessionExpired] so the UI can route back
 * to the login screen instead of spinning on repeated 401s.
 */
class ApiClient(
    private val tokenStore: TokenStore,
    private val onSessionExpired: () -> Unit,
) {
    private val gson = Gson()
    private val refreshLock = Any()

    private val authInterceptor = Interceptor { chain ->
        val token = tokenStore.accessToken
        val request = if (token != null) {
            chain.request().newBuilder().addHeader("Authorization", "Bearer $token").build()
        } else {
            chain.request()
        }
        chain.proceed(request)
    }

    /** No auth header, no 401-authenticator — used only for the refresh call itself, to avoid recursion. */
    private val plainClient = OkHttpClient.Builder().build()

    private fun priorResponseCount(response: Response): Int {
        var count = 1
        var prior = response.priorResponse
        while (prior != null) {
            count++
            prior = prior.priorResponse
        }
        return count
    }

    private val authenticator = Authenticator { _: Route?, response: Response ->
        if (priorResponseCount(response) >= 2) return@Authenticator null // already retried once — give up

        synchronized(refreshLock) {
            val refreshToken = tokenStore.refreshToken ?: return@Authenticator null
            val tokenOnFailedRequest = response.request.header("Authorization")?.removePrefix("Bearer ")

            // A concurrent request may already have refreshed while this one
            // waited on the lock — if so, just retry with the new token.
            val current = tokenStore.accessToken
            if (current != null && current != tokenOnFailedRequest) {
                return@Authenticator response.request.newBuilder()
                    .header("Authorization", "Bearer $current")
                    .build()
            }

            val body = gson.toJson(RefreshRequest(refreshToken))
                .toRequestBody("application/json".toMediaType())
            val refreshRequest = Request.Builder()
                .url(AppConfig.API_BASE_URL + "auth/refresh")
                .post(body)
                .build()

            try {
                plainClient.newCall(refreshRequest).execute().use { refreshResponse ->
                    if (!refreshResponse.isSuccessful) {
                        tokenStore.clear()
                        onSessionExpired()
                        return@Authenticator null
                    }
                    val result = gson.fromJson(refreshResponse.body?.string(), AuthResult::class.java)
                    val newAccess = result?.token
                    val newRefresh = result?.refreshToken
                    val user = result?.user
                    if (newAccess == null || newRefresh == null || user == null) {
                        tokenStore.clear()
                        onSessionExpired()
                        return@Authenticator null
                    }
                    tokenStore.saveSession(newAccess, newRefresh, user)
                    response.request.newBuilder()
                        .header("Authorization", "Bearer $newAccess")
                        .build()
                }
            } catch (e: Exception) {
                // Network failure during refresh — let this one request fail,
                // don't wipe a session that might just be offline right now.
                null
            }
        }
    }

    private val okHttpClient = OkHttpClient.Builder()
        .addInterceptor(authInterceptor)
        .authenticator(authenticator)
        .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
        .build()

    private val retrofit = Retrofit.Builder()
        .baseUrl(AppConfig.API_BASE_URL)
        .client(okHttpClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()

    val authApi: AuthApi = retrofit.create(AuthApi::class.java)
    val pumpApi: PumpApi = retrofit.create(PumpApi::class.java)
}
