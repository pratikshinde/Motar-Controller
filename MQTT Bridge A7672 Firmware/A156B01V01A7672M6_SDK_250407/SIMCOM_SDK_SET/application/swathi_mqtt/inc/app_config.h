/**
 * @file    app_config.h
 * @brief   Central configuration for A7672S MQTT Bridge
 *
 * ---------------------------------------------------------------
 *  EDIT the AWS IoT Core block below once the account is provisioned.
 * ---------------------------------------------------------------
 * AWS IoT Core with mutual TLS is the only supported transport
 * (docs/Firmware_and_Bridge_Development_Plan.md FR-CON-020). The previous
 * plain-TCP "generic broker" mode (public HiveMQ, no TLS, no credentials)
 * has been deleted from this tree entirely, not merely disabled — a mode
 * that cannot be selected cannot be selected by accident. Bench testing
 * against a local broker must use a separate short-lived branch, never a
 * build flag on main.
 */
#ifndef APP_CONFIG_H
#define APP_CONFIG_H

#include "simcom_api.h"

/* ============================================================================
 * AWS IoT Core Settings — fill in once the account/certs are provisioned.
 * MQTT_BROKER_HOST: "tcp://<your-ats-endpoint>.iot.<region>.amazonaws.com:8883"
 *   (get the endpoint via `aws iot describe-endpoint --endpoint-type iot:Data-ATS`)
 * Client ID: NOT hardcoded here — the bridge uses the MCU-asserted dev_id at
 *   runtime (g_device_id in mqtt_bridge.c). See docs/Firmware_and_Bridge_
 *   Development_Plan.md decision G-1 (identity: IMEI vs MCU UID) — still
 *   open. Certificates are issued against whichever value G-1 resolves to,
 *   so that decision must be made before certs are requested, not after.
 * ========================================================================= */
#define MQTT_BROKER_HOST        "tcp://REPLACE-ME.iot.ap-south-1.amazonaws.com:8883"
#define MQTT_SERVER_TYPE        1    /* 1 = SSL/TLS (mutual auth via SetupSSL()) */
#define MQTT_SSL_CTX_INDEX      0
#define AWS_CA_CERT_PATH        "C:/cacert.pem"
#define AWS_CLIENT_CERT_PATH    "C:/clientcert.pem"
#define AWS_CLIENT_KEY_PATH     "C:/clientkey.pem"
#define MQTT_USERNAME           ""
#define MQTT_PASSWORD           ""

/* Topics */
#define TOPIC_TELEMETRY_FMT     "devices/%s/telemetry"
#define TOPIC_FAULTS_FMT        "devices/%s/faults"
#define TOPIC_COMMANDS_FMT      "devices/%s/commands"

/* MQTT */
#define MQTT_KEEPALIVE_S        60
#define MQTT_CLEAN_SESSION      1
#define MQTT_QOS_DEFAULT        1
#define MQTT_CLIENT_INDEX       0

/* UART to MCU */
#define MCU_UART_PORT           SC_UART

/* App Info */
#define APP_NAME_STR            "Swathi_Mqtt_Bridge"
#define APP_VERSION_STR         "V1.1.0"

/* Buffers */
#define UART_RX_BUF_SIZE        512
#define MQTT_TOPIC_BUF_SIZE     128
#define MQTT_PAYLOAD_BUF_SIZE   512
#define JSON_MSG_BUF_SIZE       512

/* Timing (ticks: 1 tick = 5ms) */
#define MS_TO_TICKS(ms)             ((ms) / 5)
#define NET_CHECK_INTERVAL_MS       5000
#define NET_STATUS_REPORT_MS        30000
#define PING_TO_MCU_MS              60000
#define MQTT_RECONNECT_BASE_MS      5000
#define MQTT_RECONNECT_MAX_MS       120000
#define MAIN_LOOP_SLEEP_MS          200
#define MQTT_MSGQ_SIZE              8

/* Message IDs */
#define MSG_ID_MCU_UART             0x1001

#endif /* APP_CONFIG_H */
