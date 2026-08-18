package com.example.pumpmonitor.data.net

import com.example.pumpmonitor.data.AuthResult
import com.example.pumpmonitor.data.LogoutRequest
import com.example.pumpmonitor.data.MessageResponse
import com.example.pumpmonitor.data.MfaVerifyRequest
import com.example.pumpmonitor.data.RefreshRequest
import com.example.pumpmonitor.data.SendOtpRequest
import com.example.pumpmonitor.data.SendOtpResponse
import com.example.pumpmonitor.data.VerifyOtpRequest
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

interface AuthApi {
    @POST("auth/send-otp")
    suspend fun sendOtp(@Body body: SendOtpRequest): Response<SendOtpResponse>

    @POST("auth/verify-otp")
    suspend fun verifyOtp(@Body body: VerifyOtpRequest): Response<AuthResult>

    @POST("auth/mfa/verify")
    suspend fun verifyMfa(@Body body: MfaVerifyRequest): Response<AuthResult>

    @POST("auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): Response<AuthResult>

    @POST("auth/logout")
    suspend fun logout(@Body body: LogoutRequest): Response<MessageResponse>
}
