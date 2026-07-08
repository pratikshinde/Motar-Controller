package com.example.pumpmonitor.data

import com.example.pumpmonitor.aws.AwsConfig
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.GET
import retrofit2.http.Query

/**
 * Historical telemetry served by API Gateway -> Lambda -> Timestream/DynamoDB.
 * See aws-setup/README.md for the backend pieces.
 *
 * GET history?pumpId=WaterPump01&metric=vRY&hours=24
 */
interface HistoryApi {

    @GET("history")
    suspend fun getHistory(
        @Query("pumpId") pumpId: String = AwsConfig.THING_NAME,
        @Query("metric") metric: String = "vRY",
        @Query("hours") hours: Int = 24,
    ): HistoryResponse

    companion object {
        fun create(): HistoryApi {
            val client = OkHttpClient.Builder()
                .addInterceptor(HttpLoggingInterceptor().apply {
                    level = HttpLoggingInterceptor.Level.BASIC
                })
                .build()
            return Retrofit.Builder()
                .baseUrl(AwsConfig.HISTORY_API_BASE_URL)
                .client(client)
                .addConverterFactory(GsonConverterFactory.create())
                .build()
                .create(HistoryApi::class.java)
        }
    }
}
