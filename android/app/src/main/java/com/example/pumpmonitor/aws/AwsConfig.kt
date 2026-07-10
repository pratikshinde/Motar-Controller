package com.example.pumpmonitor.aws

import com.amazonaws.regions.Regions

/**
 * ---------------------------------------------------------------
 *  EDIT THIS FILE — the only place with your AWS-specific values.
 * ---------------------------------------------------------------
 */
object AwsConfig {

    /** AWS region where your IoT Core + Cognito live. */
    val REGION: Regions = Regions.AP_SOUTH_1

    /**
     * Cognito Identity Pool ID (Federated Identities).
     * Console: Cognito -> Identity pools -> <your pool> -> Identity pool ID
     * e.g. "ap-south-1:1a2b3c4d-...."
     */
    const val COGNITO_IDENTITY_POOL_ID = "ap-south-1:REPLACE-ME"

    /**
     * Your account-specific IoT device data endpoint (ATS).
     * CLI:  aws iot describe-endpoint --endpoint-type iot:Data-ATS
     * e.g. "a1b2c3d4e5f6g7-ats.iot.ap-south-1.amazonaws.com"
     */
    const val IOT_ENDPOINT = "REPLACE-ME-ats.iot.ap-south-1.amazonaws.com"

    /**
     * Fallback pump shown when the pumps API isn't deployed/reachable, so the
     * app stays usable with a single hardcoded pump during bring-up.
     */
    const val DEFAULT_THING_NAME = "WaterPump01"

    /**
     * API Gateway base URL — one HTTP API serving GET /history (charts) and
     * GET /pumps (the signed-in user's pump list). See aws-setup/.
     * e.g. "https://abc123.execute-api.ap-south-1.amazonaws.com/prod/"
     */
    const val API_BASE_URL = "https://REPLACE-ME.execute-api.ap-south-1.amazonaws.com/prod/"

    // ---- Per-pump MQTT topics (thing = the pump's IoT Thing name) ----

    fun telemetryTopic(thing: String) = "pumps/$thing/telemetry"
    fun shadowUpdate(thing: String) = "\$aws/things/$thing/shadow/update"
    fun shadowUpdateAccepted(thing: String) = "\$aws/things/$thing/shadow/update/accepted"
    fun shadowGet(thing: String) = "\$aws/things/$thing/shadow/get"
    fun shadowGetAccepted(thing: String) = "\$aws/things/$thing/shadow/get/accepted"
}
