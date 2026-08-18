package com.example.pumpmonitor.data.net

import com.example.pumpmonitor.data.AlertResolveRequest
import com.example.pumpmonitor.data.AlertsResponse
import com.example.pumpmonitor.data.CommandAccepted
import com.example.pumpmonitor.data.CommandRequest
import com.example.pumpmonitor.data.FaultAckRequest
import com.example.pumpmonitor.data.FaultsResponse
import com.example.pumpmonitor.data.MessageResponse
import com.example.pumpmonitor.data.PumpDetailResponse
import com.example.pumpmonitor.data.PumpsListResponse
import com.example.pumpmonitor.data.TelemetryHistoryResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface PumpApi {
    @GET("pumps")
    suspend fun getPumps(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 50,
    ): Response<PumpsListResponse>

    @GET("pumps/{id}")
    suspend fun getPump(@Path("id") pumpId: String): Response<PumpDetailResponse>

    @POST("pumps/{id}/command")
    suspend fun sendCommand(@Path("id") pumpId: String, @Body body: CommandRequest): Response<CommandAccepted>

    @GET("pumps/{id}/telemetry")
    suspend fun getTelemetry(
        @Path("id") pumpId: String,
        @Query("hours") hours: Int = 24,
        @Query("limit") limit: Int = 200,
    ): Response<TelemetryHistoryResponse>

    @GET("pumps/{id}/faults")
    suspend fun getFaults(
        @Path("id") pumpId: String,
        @Query("open") open: Boolean? = null,
        @Query("limit") limit: Int = 100,
    ): Response<FaultsResponse>

    @POST("pumps/{id}/faults/{faultId}/ack")
    suspend fun ackFault(
        @Path("id") pumpId: String,
        @Path("faultId") faultId: String,
        @Body body: FaultAckRequest,
    ): Response<MessageResponse>

    @GET("alerts")
    suspend fun getAlerts(
        @Query("status") status: String? = null,
        @Query("pump_id") pumpId: String? = null,
    ): Response<AlertsResponse>

    @POST("alerts/{id}/ack")
    suspend fun ackAlert(@Path("id") alertId: String): Response<MessageResponse>

    @POST("alerts/{id}/resolve")
    suspend fun resolveAlert(@Path("id") alertId: String, @Body body: AlertResolveRequest): Response<MessageResponse>
}
