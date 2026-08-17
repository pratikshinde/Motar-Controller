/**
 * @file    app_config.h
 * @brief   Central configuration for A7672S MQTT Bridge
 */
#ifndef APP_CONFIG_H
#define APP_CONFIG_H

#include "simcom_api.h"

/* ============================================================================
 * BROKER MODE — uncomment exactly ONE
 * ========================================================================= */
/* #define MQTT_MODE_AWS_IOT */
#define MQTT_MODE_GENERIC

/* ============================================================================
 * AWS IoT Core Settings
 * ========================================================================= */
#ifdef MQTT_MODE_AWS_IOT
#define MQTT_BROKER_HOST        "tcp://your-endpoint.iot.ap-south-1.amazonaws.com:8883"
#define MQTT_CLIENT_ID          "SwathiSwitchgear_001"
#define MQTT_SERVER_TYPE        1    /* 1 = SSL/TLS */
#define MQTT_SSL_CTX_INDEX      0
#define AWS_CA_CERT_PATH        "C:/cacert.pem"
#define AWS_CLIENT_CERT_PATH    "C:/clientcert.pem"
#define AWS_CLIENT_KEY_PATH     "C:/clientkey.pem"
#define MQTT_USERNAME           ""
#define MQTT_PASSWORD           ""
#endif

/* ============================================================================
 * Generic MQTT Broker Settings
 * ========================================================================= */
#ifdef MQTT_MODE_GENERIC
#define MQTT_BROKER_DOMAIN      "mqtt-dashboard.com"
#define MQTT_BROKER_PORT        1883
#define MQTT_BROKER_FALLBACK_IP "3.120.11.244"
#define MQTT_CLIENT_ID          "SwathiSwitchgear_001"
#define MQTT_SERVER_TYPE        0    /* 0 = plain TCP */
#define MQTT_USERNAME           ""
#define MQTT_PASSWORD           ""
#endif

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
#define APP_VERSION_STR         "V1.0.1"

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
