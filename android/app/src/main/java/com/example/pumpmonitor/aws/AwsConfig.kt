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

    /** IoT Thing name of the pump controller. */
    const val THING_NAME = "WaterPump01"

    /** Topic the pump firmware publishes telemetry JSON to. */
    const val TELEMETRY_TOPIC = "pumps/$THING_NAME/telemetry"

    /** Device Shadow topics (classic shadow). */
    const val SHADOW_UPDATE = "\$aws/things/$THING_NAME/shadow/update"
    const val SHADOW_UPDATE_ACCEPTED = "\$aws/things/$THING_NAME/shadow/update/accepted"
    const val SHADOW_GET = "\$aws/things/$THING_NAME/shadow/get"
    const val SHADOW_GET_ACCEPTED = "\$aws/things/$THING_NAME/shadow/get/accepted"

    /**
     * API Gateway base URL for historical telemetry (see aws-setup/README).
     * e.g. "https://abc123.execute-api.ap-south-1.amazonaws.com/prod/"
     */
    const val HISTORY_API_BASE_URL = "https://REPLACE-ME.execute-api.ap-south-1.amazonaws.com/prod/"
}
