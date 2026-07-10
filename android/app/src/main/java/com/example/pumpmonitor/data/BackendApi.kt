package com.example.pumpmonitor.data

import com.example.pumpmonitor.aws.AwsConfig
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.GET
import retrofit2.http.Query

/**
 * REST backend behind one API Gateway (see aws-setup/):
 *  - GET history?pumpId=WaterPump01&metric=vRY&hours=24  -> Lambda -> Timestream
 *  - GET pumps?userId=+919876543210                      -> Lambda -> DynamoDB
 */
interface BackendApi {

    @GET("history")
    suspend fun getHistory(
        @Query("pumpId") pumpId: String,
        @Query("metric") metric: String = "vRY",
        @Query("hours") hours: Int = 24,
    ): HistoryResponse

    /** userId is the signed-in user's phone number in E.164 (+91...). */
    @GET("pumps")
    suspend fun getPumps(
        @Query("userId") userId: String,
    ): PumpsResponse

    companion object {
        fun create(): BackendApi {
            val client = OkHttpClient.Builder()
                .addInterceptor(HttpLoggingInterceptor().apply {
                    level = HttpLoggingInterceptor.Level.BASIC
                })
                .build()
            return Retrofit.Builder()
                .baseUrl(AwsConfig.API_BASE_URL)
                .client(client)
                .addConverterFactory(GsonConverterFactory.create())
                .build()
                .create(BackendApi::class.java)
        }
    }
}
