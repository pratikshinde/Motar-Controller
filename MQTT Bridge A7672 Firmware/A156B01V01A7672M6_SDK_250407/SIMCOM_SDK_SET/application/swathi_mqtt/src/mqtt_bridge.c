/**
 * @file    mqtt_bridge.c
 * @brief   MQTT Bridge — M031 MCU <-> AWS IoT Core (mutual TLS only)
 * @details Uses SIMCOM OpenSDK native sAPI functions.
 *
 * Phase F1 security hardening (docs/Firmware_and_Bridge_Development_Plan.md):
 *  - Plain-TCP "generic broker" mode deleted entirely (FR-CON-020).
 *  - Inbound cloud commands are now parsed, whitelisted and range-checked
 *    before anything reaches the MCU UART, and re-serialised from the
 *    parsed form rather than forwarded verbatim (FR-CON-022/040-044,
 *    closes GAP-22 — previously any payload published to the commands
 *    topic reached the MCU parser unchecked, and motor_cmd is applied
 *    unconditionally there).
 *  - Debug/diagnostic logging no longer touches the MCU UART at all (closes
 *    GAP-24/F-6 — it previously shared the wire with inbound commands and
 *    could corrupt one in flight).
 *  - Registration ack is sent exactly once, reflecting the true outcome
 *    (F-13 — it previously always sent a false "failed" ack first).
 *
 * NOT changed here: device identity (still the MCU-asserted dev_id — see
 * plan decision G-1, open) and anything in firmware/ (motor protection is
 * explicitly out of scope for this pass, verified separately on a live
 * pump by the product owner).
 */

#include "simcom_api.h"
#include "app_config.h"
#include "cJSON.h"
#include "string.h"
#include "stdlib.h"
#include "stdio.h"
#include <stdarg.h>

#include "simcom_tcpip.h"
#include "simcom_tcpip_old.h"

/* Task handles and stacks */
static sTaskRef g_bridgeTask = NULL;
static UINT8    g_bridgeTaskStack[SC_DEFAULT_THREAD_STACKSIZE * 4] __attribute__((aligned(8)));
static sTaskRef g_recvTask = NULL;
static UINT8    g_recvTaskStack[SC_DEFAULT_THREAD_STACKSIZE * 2] __attribute__((aligned(8)));
static sTaskRef g_reporterTask = NULL;
static UINT8    g_reporterTaskStack[SC_DEFAULT_THREAD_STACKSIZE * 2] __attribute__((aligned(8)));

/* Message queues */
static sMsgQRef g_mqtt_urc_msgq = NULL;
static sMsgQRef g_mcu_rx_msgq   = NULL;

/* State */
static char g_device_id[32] = "unknown";
static int  g_registered = 0;
static char g_topic_telemetry[MQTT_TOPIC_BUF_SIZE];
static char g_topic_faults[MQTT_TOPIC_BUF_SIZE];
static char g_topic_commands[MQTT_TOPIC_BUF_SIZE];
static volatile int g_mqtt_connected = 0;
static unsigned int g_rejected_command_count = 0;

/* ============================================================================
 * JSON Parser (from M031 IoT_Comm.c) — used only for MCU-UART-side messages
 * (reg/status/fault/ack), which are trusted (the MCU is our own firmware).
 * Inbound cloud commands use the strict cJSON validator below instead.
 * ========================================================================= */
static int Json_GetStr(const char *json, const char *key, char *buf, int buf_size)
{
    char search[48];
    snprintf(search, sizeof(search), "\"%s\":", key);
    const char *p = strstr(json, search);
    if (!p) return 0;
    p += strlen(search);
    while (*p == ' ') p++;
    if (*p != '"') return 0;
    p++;
    int i = 0;
    while (*p && *p != '"' && i < buf_size - 1) buf[i++] = *p++;
    buf[i] = '\0';
    return 1;
}

/* ============================================================================
 * UART helpers — send to MCU
 * ========================================================================= */
static void SendToMCU(const char *json)
{
    sAPI_UartWrite(MCU_UART_PORT, (UINT8 *)json, strlen(json));
    sAPI_UartWrite(MCU_UART_PORT, (UINT8 *)"\n", 1);
}

/**
 * Bridge-internal diagnostic log. Goes to the module's own debug console
 * (visible over USB/CATStudio) only — it must NEVER write to MCU_UART_PORT.
 * That UART also carries inbound MQTT commands to the MCU, and this
 * function used to write there too (as "McuDebugPrint"): a log line could
 * land in the middle of a command in flight and corrupt it (F-6/GAP-24).
 */
static void BridgeDebugLog(const char *fmt, ...)
{
    char buf[256];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    sAPI_Debug("[MQTT] %s", buf);
}

static void SendNetStatus(int connected, int signal_dbm)
{
    char buf[128];
    snprintf(buf, sizeof(buf), "{\"cmd\":\"net_status\",\"conn\":%d,\"sig\":%d}", connected, signal_dbm);
    SendToMCU(buf);
}

static void SendPing(void)  { SendToMCU("{\"cmd\":\"ping\"}"); }

static void SendRegAck(int ok)
{
    char buf[64];
    snprintf(buf, sizeof(buf), "{\"cmd\":\"reg_ack\",\"ok\":%d}", ok);
    SendToMCU(buf);
}

/* ============================================================================
 * Network
 * ========================================================================= */
static int WaitForNetwork(void)
{
    int cgreg = 0;
    for (int i = 0; i < 60; i++) {
        sAPI_NetworkGetCgreg(&cgreg);
        if (cgreg == 1 || cgreg == 5) {
            sAPI_Debug("[MQTT] Network registered (cgreg=%d). Activating PDP...", cgreg);
            if (sAPI_TcpipPdpActive(1, 1) == SC_TCPIP_SUCCESS) {
                sAPI_Debug("[MQTT] PDP activated! Waiting 3s for IP stack...");
                sAPI_TaskSleep(MS_TO_TICKS(3000));
                return 0;
            }
            sAPI_Debug("[MQTT] PDP activation failed, retrying...");
        }
        sAPI_Debug("[MQTT] cgreg=%d, waiting...", cgreg);
        sAPI_TaskSleep(MS_TO_TICKS(NET_CHECK_INTERVAL_MS));
    }
    return -1;
}

static int GetSignalDbm(void)
{
    UINT8 csq = 0;
    sAPI_NetworkGetCsq(&csq);
    if (csq == 99 || csq == 0) return -999;
    return -113 + (csq * 2);
}

/* ============================================================================
 * SSL Setup (mutual TLS — always required, see FR-CON-020)
 * ========================================================================= */
static void SetupSSL(void)
{
    sAPI_SslSetContextIdMsg("sslversion",  MQTT_SSL_CTX_INDEX, "3");
    sAPI_SslSetContextIdMsg("authmode",    MQTT_SSL_CTX_INDEX, "2");
    sAPI_SslSetContextIdMsg("cacert",      MQTT_SSL_CTX_INDEX, AWS_CA_CERT_PATH);
    sAPI_SslSetContextIdMsg("clientcert",  MQTT_SSL_CTX_INDEX, AWS_CLIENT_CERT_PATH);
    sAPI_SslSetContextIdMsg("clientkey",   MQTT_SSL_CTX_INDEX, AWS_CLIENT_KEY_PATH);
    sAPI_Debug("[MQTT] SSL context configured");
}

/* ============================================================================
 * MQTT Connect / Disconnect / Publish
 * ========================================================================= */
static int MqttConnect(void)
{
    SCmqttReturnCode ret;

    BridgeDebugLog("MqttStart calling...");
    ret = sAPI_MqttStart(-1);
    BridgeDebugLog("MqttStart returned: %d", ret);
    if (ret != SC_MQTT_RESULT_SUCCESS) {
        sAPI_MqttRel(MQTT_CLIENT_INDEX);
        sAPI_MqttStop();
        sAPI_TaskSleep(MS_TO_TICKS(1000));
        ret = sAPI_MqttStart(-1);
        BridgeDebugLog("MqttStart retry returned: %d", ret);
        if (ret != SC_MQTT_RESULT_SUCCESS) return -1;
    }

    BridgeDebugLog("MqttAccq calling client_id=%s...", g_device_id);
    ret = sAPI_MqttAccq(0, NULL, MQTT_CLIENT_INDEX, g_device_id,
                        MQTT_SERVER_TYPE, g_mqtt_urc_msgq);
    BridgeDebugLog("MqttAccq returned: %d", ret);
    if (ret != SC_MQTT_RESULT_SUCCESS) return -1;

    /* Set UTF8 check OFF: (SET, NULL, client_index, config_type=0 "checkUTF8", value=0) */
    ret = sAPI_MqttCfg(SC_MQTT_OP_SET, NULL, MQTT_CLIENT_INDEX, 0, 0);
    BridgeDebugLog("MqttCfg(utf8) returned: %d", ret);

    /* Set optimeout=30s: (SET, NULL, client_index, config_type=1 "optimeout", value=30) */
    ret = sAPI_MqttCfg(SC_MQTT_OP_SET, NULL, MQTT_CLIENT_INDEX, 1, 30);
    BridgeDebugLog("MqttCfg(timeout) returned: %d", ret);

    SetupSSL();
    ret = sAPI_MqttSslCfg(0, NULL, MQTT_CLIENT_INDEX, MQTT_SSL_CTX_INDEX);
    if (ret != SC_MQTT_RESULT_SUCCESS) return -1;

    char *user = NULL;
    char *pass = NULL;
    if (strlen(MQTT_USERNAME) > 0) user = MQTT_USERNAME;
    if (strlen(MQTT_PASSWORD) > 0) pass = MQTT_PASSWORD;

    BridgeDebugLog("MqttConnect to %s...", MQTT_BROKER_HOST);
    ret = sAPI_MqttConnect(0, NULL, MQTT_CLIENT_INDEX, MQTT_BROKER_HOST,
                           MQTT_KEEPALIVE_S, MQTT_CLEAN_SESSION,
                           user, pass);
    BridgeDebugLog("MqttConnect returned: %d", ret);
    if (ret != SC_MQTT_RESULT_SUCCESS) {
        return -1;
    }

    g_mqtt_connected = 1;
    BridgeDebugLog("Connected! Subscribing to %s...", g_topic_commands);

    ret = sAPI_MqttSub(MQTT_CLIENT_INDEX, g_topic_commands,
                       strlen(g_topic_commands), MQTT_QOS_DEFAULT, 0);
    BridgeDebugLog("MqttSub returned: %d", ret);

    /* The single, truthful registration ack — sent only once the connection
     * and subscription have actually succeeded (F-13). Previously
     * RouteMcuToMqtt() also sent one immediately on "reg", before MQTT was
     * even connected, which was always a false ok:0. */
    SendRegAck(1);

    return 0;
}

static void MqttDisconnect(void)
{
    sAPI_MqttDisConnect(0, NULL, MQTT_CLIENT_INDEX, MQTT_KEEPALIVE_S);
    sAPI_MqttRel(MQTT_CLIENT_INDEX);
    sAPI_MqttStop();
    g_mqtt_connected = 0;
}

static int MqttPublish(const char *topic, const char *payload)
{
    if (!g_mqtt_connected) return -1;
    if (sAPI_MqttTopic(MQTT_CLIENT_INDEX, (char *)topic, strlen(topic)) != SC_MQTT_RESULT_SUCCESS) return -1;
    if (sAPI_MqttPayload(MQTT_CLIENT_INDEX, (char *)payload, strlen(payload)) != SC_MQTT_RESULT_SUCCESS) return -1;
    if (sAPI_MqttPub(MQTT_CLIENT_INDEX, MQTT_QOS_DEFAULT, MQTT_KEEPALIVE_S, 0, 0) != SC_MQTT_RESULT_SUCCESS) return -1;
    return 0;
}

/* ============================================================================
 * Inbound command validation (SRS §6.6 — the bridge is the trust boundary)
 *
 * The MCU applies motor_cmd unconditionally and has no other defence
 * (GAP-22). Nothing may reach the MCU UART from the commands topic that
 * has not been parsed, whitelisted and range-checked here, and the
 * forwarded message is always rebuilt from the parsed form — never the
 * original bytes — so no malformed shape, duplicate key or trailing data
 * can be smuggled through (FR-CON-040/041/042/043/044).
 *
 * The settings key/range table below is intentionally an exact mirror of
 * the switch in firmware/IoT_Comm.c's "settings" handler — it must be kept
 * in lockstep with that file (FR-CON-046). Do not add a key here until the
 * MCU firmware actually implements it: `uv`/`uv_t` (under-voltage) are
 * proposed in SRS §6.1 but not yet read by any MCU logic (see plan finding
 * F-8) — whitelisting them here would let a message pass validation only to
 * be silently ignored by the MCU, which defeats the point of FR-CON-043
 * ("unknown keys shall cause the whole message to be rejected").
 * ========================================================================= */
typedef struct { const char *key; int min; int max; } SettingRange;

static const SettingRange kSettingRanges[] = {
    {"hp",     1,   13},
    {"as",     2,   600},
    {"sd",     1,   60},
    {"ov",     300, 600},
    {"dr",     1,   50},
    {"dr_t",   0,   25},
    {"dr_rst", 0,   250},
    {"imb",    1,   80},
    {"ar",     0,   1},
    {"cyc",    0,   1},
    {"on_t",   1,   250},
    {"rst_t",  0,   250},
    {"ct",     1,   50},
    {"ph",     0,   15},
    {"ps",     0,   1},
    {"ol",     2,   140},
};
#define NUM_SETTING_RANGES (sizeof(kSettingRanges) / sizeof(kSettingRanges[0]))

/* Returns 1 if key is known and val is within its range, else 0 (unknown
 * key and out-of-range both reject — FR-CON-043). */
static int RangeCheckKey(const char *key, int val)
{
    for (unsigned int i = 0; i < NUM_SETTING_RANGES; i++) {
        if (strcmp(kSettingRanges[i].key, key) == 0) {
            return (val >= kSettingRanges[i].min && val <= kSettingRanges[i].max);
        }
    }
    return 0;
}

/**
 * Copies a cJSON_Print()/cJSON_PrintUnformatted() result into an
 * sAPI_Malloc'd buffer and releases the original.
 *
 * cJSON.h documents cJSON_Print's output as "free the char* when finished"
 * (the upstream Dave Gamble contract) — that is a plain C free(), not
 * sAPI_Free(). Everything else in this file is sAPI_Malloc/sAPI_Free
 * because it is a SIMCom-modified cJSON build (cJSON_Hooks takes a UINT32
 * size, matching sAPI_Malloc's signature, not the standard size_t), so the
 * *tree* allocator (cJSON_Parse/cJSON_CreateObject/cJSON_Delete) plausibly
 * is sAPI_Malloc-backed — but the header's own contract for the *printed
 * string* specifically still says free(), and that documented contract is
 * the only verifiable fact available without the (gitignored) cJSON.c
 * source. This function exists as the single place that decision is made,
 * so it can be corrected in one spot if the first bench build proves it
 * wrong (a heap corruption here would be silent and intermittent, not a
 * compiler error — worth an explicit watch on first hardware bring-up).
 */
static char *CopyPrintedJson(char *cjson_owned)
{
    if (!cjson_owned) return NULL;
    char *copy = sAPI_Malloc(strlen(cjson_owned) + 1);
    if (copy) strcpy(copy, cjson_owned);
    free(cjson_owned);
    return copy;
}

/**
 * Parses, whitelists and range-checks a raw cloud command payload.
 * Returns an sAPI_Malloc'd, re-serialised, MCU-safe command on success —
 * the caller must sAPI_Free() it. Returns NULL if the command is rejected
 * for any reason (parse failure, unknown cmd, bad shape, out-of-range or
 * unknown field).
 */
static char *ValidateAndRebuildCommand(const char *raw)
{
    if (strlen(raw) >= MQTT_PAYLOAD_BUF_SIZE) return NULL; /* FR-CON-040 */

    cJSON *root = cJSON_Parse(raw);
    if (!root) return NULL;
    if (root->type != cJSON_Object) {
        cJSON_Delete(root);
        return NULL;
    }

    cJSON *cmdItem = cJSON_GetObjectItem(root, "cmd");
    if (!cmdItem || cmdItem->type != cJSON_String) {
        cJSON_Delete(root);
        return NULL;
    }

    char *result = NULL;

    if (strcmp(cmdItem->valuestring, "motor_cmd") == 0) {
        /* FR-CON-042: action must be exactly "on" or "off". */
        cJSON *action = cJSON_GetObjectItem(root, "action");
        if (action && action->type == cJSON_String &&
            (strcmp(action->valuestring, "on") == 0 || strcmp(action->valuestring, "off") == 0)) {
            cJSON *out = cJSON_CreateObject();
            if (out) {
                cJSON_AddStringToObject(out, "cmd", "motor_cmd");
                cJSON_AddStringToObject(out, "action", action->valuestring);
                result = CopyPrintedJson(cJSON_PrintUnformatted(out));
                cJSON_Delete(out);
            }
        }

    } else if (strcmp(cmdItem->valuestring, "settings") == 0) {
        /* FR-CON-043: every key must be in the table and every value in
         * range, or the whole message is rejected — no partial apply. */
        cJSON *out = cJSON_CreateObject();
        if (out) {
            cJSON_AddStringToObject(out, "cmd", "settings");
            int fieldCount = 0;
            int allValid = 1;
            for (cJSON *field = root->child; field; field = field->next) {
                if (!field->string || strcmp(field->string, "cmd") == 0) continue;
                fieldCount++;
                if (field->type != cJSON_Number || !RangeCheckKey(field->string, field->valueint)) {
                    allValid = 0;
                    break;
                }
                cJSON_AddNumberToObject(out, field->string, field->valueint);
            }
            if (allValid && fieldCount > 0) {
                result = CopyPrintedJson(cJSON_PrintUnformatted(out));
            }
            cJSON_Delete(out);
        }

    } else if (strcmp(cmdItem->valuestring, "ping") == 0) {
        /* FR-CON-041/vocabulary: no arguments permitted — always rebuild
         * the canonical fixed form regardless of what else was in the
         * payload. */
        static const char kPing[] = "{\"cmd\":\"ping\"}";
        result = sAPI_Malloc(sizeof(kPing));
        if (result) strcpy(result, kPing);
    }
    /* Anything else — including get_settings/reset_fault (not yet
     * implemented by this MCU firmware, see plan F4) and any value outside
     * the accepted vocabulary — is rejected, not forwarded. */

    cJSON_Delete(root);
    return result;
}

/* ============================================================================
 * Route MCU message -> MQTT topic
 * ========================================================================= */
static void RouteMcuToMqtt(const char *json)
{
    char cmd[16] = {0};
    if (!Json_GetStr(json, "cmd", cmd, sizeof(cmd))) return;

    if (strcmp(cmd, "reg") == 0) {
        Json_GetStr(json, "dev_id", g_device_id, sizeof(g_device_id));
        snprintf(g_topic_telemetry, sizeof(g_topic_telemetry), TOPIC_TELEMETRY_FMT, g_device_id);
        snprintf(g_topic_faults,    sizeof(g_topic_faults),    TOPIC_FAULTS_FMT,    g_device_id);
        snprintf(g_topic_commands,  sizeof(g_topic_commands),  TOPIC_COMMANDS_FMT,  g_device_id);
        g_registered = 1;
        /* No publish attempt and no ack here — MQTT is deliberately not
         * yet connected at this point (connection is gated on
         * g_registered, see the main loop below), so any publish here
         * would always fail. The single truthful reg_ack is sent from
         * MqttConnect() once the connection genuinely succeeds (F-13). */
    } else if (g_registered && strcmp(cmd, "status") == 0) {
        MqttPublish(g_topic_telemetry, json);
    } else if (g_registered && strcmp(cmd, "fault") == 0) {
        MqttPublish(g_topic_faults, json);
    } else if (g_registered && strcmp(cmd, "ack") == 0) {
        MqttPublish(g_topic_telemetry, json);
    }
    /* heartbeat/pong = internal only, not published */
}

/* ============================================================================
 * MCU UART RX Callback
 * ========================================================================= */
static void McuUartCallback(SC_Uart_Port_Number port, void *para)
{
    char *data = sAPI_Malloc(UART_RX_BUF_SIZE);
    if (!data) return;
    int len = sAPI_UartRead(port, (UINT8 *)data, UART_RX_BUF_SIZE);
    if (len > 0 && g_mcu_rx_msgq) {
        SIM_MSG_T msg = {0, 0, 0, NULL};
        msg.msg_id = MSG_ID_MCU_UART;
        msg.arg2 = len;
        msg.arg3 = sAPI_Malloc(len + 1);
        if (msg.arg3) {
            memcpy(msg.arg3, data, len);
            ((char *)msg.arg3)[len] = '\0';
            if (sAPI_MsgQSend(g_mcu_rx_msgq, &msg) != SC_SUCCESS)
                sAPI_Free(msg.arg3);
        }
    }
    sAPI_Free(data);
}

/* ============================================================================
 * MQTT Receive Task — validates and forwards cloud commands to the MCU
 * ========================================================================= */
static void MqttRecvTask(void *arg)
{
    (void)arg;
    sAPI_TaskSleep(MS_TO_TICKS(5000));
    sAPI_Debug("[MQTT] Recv task started");
    while (1) {
        SIM_MSG_T msgQ = {SIM_MSG_INIT, 0, -1, NULL};
        sAPI_MsgQRecv(g_mqtt_urc_msgq, &msgQ, SC_SUSPEND);

        if (SC_SRV_MQTT != msgQ.msg_id || 0 != msgQ.arg1 || NULL == msgQ.arg3) {
            continue;
        }

        SCmqttData *sub = (SCmqttData *)(msgQ.arg3);
        sAPI_Debug("[MQTT] RX: topic=%s len=%d", sub->topic_P, sub->payload_len);

        if (sub->payload_P && sub->payload_len > 0 && sub->payload_len < MQTT_PAYLOAD_BUF_SIZE) {
            char *copy = sAPI_Malloc(sub->payload_len + 1);
            if (copy) {
                memcpy(copy, sub->payload_P, sub->payload_len);
                copy[sub->payload_len] = '\0';

                char *validated = ValidateAndRebuildCommand(copy);
                if (validated) {
                    BridgeDebugLog("RX command accepted: %s", validated);
                    SendToMCU(validated);
                    sAPI_Free(validated);
                } else {
                    g_rejected_command_count++;
                    BridgeDebugLog("RX command REJECTED (total rejected: %u): %s",
                                    g_rejected_command_count, copy);
                }
                sAPI_Free(copy);
            }
        }
        sAPI_Free(sub->topic_P);
        sAPI_Free(sub->payload_P);
        sAPI_Free(sub);
    }
}

/* ============================================================================
 * Connection Lost Callback
 * ========================================================================= */
static void MqttConnLostHandler(int client_index, int cause)
{
    sAPI_Debug("[MQTT] Connection lost! client=%d cause=%d", client_index, cause);
    g_mqtt_connected = 0;
}

/* ============================================================================
 * Main Bridge Task
 * ========================================================================= */
static void MqttBridgeTask(void *arg)
{
    (void)arg;
    sAPI_TaskSleep(MS_TO_TICKS(5000));
    static char line_buf[JSON_MSG_BUF_SIZE];
    static int  line_pos = 0;
    UINT32 last_net_tick = 0, last_ping_tick = 0, last_reconn_tick = 0;
    UINT32 reconn_delay = MQTT_RECONNECT_BASE_MS;
    int first_connect_attempt = 1; /* F-18: nothing to disconnect before the first try */

    sAPI_Debug("[MQTT] Bridge task started");
    SendNetStatus(0, -999);

    /* Phase 1: Network */
    while (WaitForNetwork() != 0) {
        sAPI_Debug("[MQTT] Retrying network...");
        sAPI_TaskSleep(MS_TO_TICKS(10000));
    }
    SendNetStatus(1, GetSignalDbm());

    /* Phase 2: Default topics (real ones are set once the MCU registers) */
    snprintf(g_topic_telemetry, sizeof(g_topic_telemetry), TOPIC_TELEMETRY_FMT, g_device_id);
    snprintf(g_topic_faults,    sizeof(g_topic_faults),    TOPIC_FAULTS_FMT,    g_device_id);
    snprintf(g_topic_commands,  sizeof(g_topic_commands),  TOPIC_COMMANDS_FMT,  g_device_id);

    /* Phase 3: Prepare Main Loop (MQTT connection will be established asynchronously once MCU registers) */
    SendNetStatus(1, GetSignalDbm());
    reconn_delay = MQTT_RECONNECT_BASE_MS;
    last_net_tick = last_ping_tick = sAPI_GetTicks();
    last_reconn_tick = 0; /* Try immediately on registration */

    /* Phase 4: Main loop */
    while (1) {
        UINT32 now = sAPI_GetTicks();

        /* 4a. MCU UART messages */
        {
            SIM_MSG_T um = {0,0,0,NULL};
            if (sAPI_MsgQRecv(g_mcu_rx_msgq, &um, MS_TO_TICKS(50)) == SC_SUCCESS) {
                if (um.msg_id == MSG_ID_MCU_UART && um.arg3) {
                    char *d = (char *)um.arg3;
                    for (int i = 0; i < um.arg2; i++) {
                        if (d[i] == '\n' || d[i] == '\r') {
                            if (line_pos > 0) {
                                line_buf[line_pos] = '\0';
                                RouteMcuToMqtt(line_buf);
                                line_pos = 0;
                            }
                        } else if (line_pos < JSON_MSG_BUF_SIZE - 1) {
                            line_buf[line_pos++] = d[i];
                        }
                    }
                    sAPI_Free(um.arg3);
                }
            }
        }

        /* 4b. Periodic net_status */
        if ((now - last_net_tick) >= MS_TO_TICKS(NET_STATUS_REPORT_MS)) {
            SendNetStatus(g_mqtt_connected ? 1 : 0, GetSignalDbm());
            last_net_tick = now;
        }

        /* 4c. Periodic ping */
        if ((now - last_ping_tick) >= MS_TO_TICKS(PING_TO_MCU_MS)) {
            SendPing();
            last_ping_tick = now;
        }

        /* 4d. Connect / Reconnect (only when registered by MCU) */
        if (g_registered && !g_mqtt_connected) {
            if (last_reconn_tick == 0 || (now - last_reconn_tick) >= MS_TO_TICKS(reconn_delay)) {
                BridgeDebugLog("Initiating connection...");
                if (!first_connect_attempt) {
                    MqttDisconnect();
                    sAPI_TaskSleep(MS_TO_TICKS(1000));
                }
                first_connect_attempt = 0;
                if (MqttConnect() == 0) {
                    reconn_delay = MQTT_RECONNECT_BASE_MS;
                    SendNetStatus(1, GetSignalDbm());
                } else {
                    reconn_delay = (reconn_delay * 2 > MQTT_RECONNECT_MAX_MS) ? MQTT_RECONNECT_MAX_MS : reconn_delay * 2;
                    SendNetStatus(0, GetSignalDbm());
                }
                last_reconn_tick = now;
            }
        }

        sAPI_TaskSleep(MS_TO_TICKS(MAIN_LOOP_SLEEP_MS));
    }
}

/* ============================================================================
 * Periodic Reporter Task — network diagnostics every 2 seconds
 *
 * F-6/GAP-24 fix: this used to also write to SC_UART, which is
 * MCU_UART_PORT — the same wire inbound commands travel on — every 2
 * seconds, keeping the MCU's RX ring under constant, needless pressure.
 * SC_UART2 is a distinct physical port (not MCU-facing) and is unaffected;
 * sAPI_Debug remains available on the module's own console.
 * ========================================================================= */
static void PeriodicReporterTask(void *arg)
{
    (void)arg;
    sAPI_Debug("[REPORTER] Periodic reporter task started");

    SCuartConfiguration cfg;
    cfg.BaudRate  = SC_UART_BAUD_115200;
    cfg.DataBits  = SC_UART_WORD_LEN_8;
    cfg.ParityBit = SC_UART_NO_PARITY_BITS;
    cfg.StopBits  = SC_UART_ONE_STOP_BIT;
    sAPI_UartSetConfig(SC_UART2, &cfg);

    while (1) {
        int cgreg = 0;
        int creg = 0;
        UINT8 csq = 0;

        sAPI_NetworkGetCgreg(&cgreg);
        sAPI_NetworkGetCreg(&creg);
        sAPI_NetworkGetCsq(&csq);

        int signal_dbm = -999;
        if (csq != 99 && csq != 0) {
            signal_dbm = -113 + (csq * 2);
        }

        char json_buf[256];
        snprintf(json_buf, sizeof(json_buf),
                 "{\"event\":\"net_update\",\"cgreg\":%d,\"creg\":%d,\"csq\":%d,\"dbm\":%d,\"mqtt_conn\":%d}\r\n",
                 cgreg, creg, csq, signal_dbm, g_mqtt_connected);

        /* SC_UART2 only — never MCU_UART_PORT. */
        sAPI_UartWrite(SC_UART2, (UINT8 *)json_buf, strlen(json_buf));
        sAPI_Debug("[REPORTER] %s", json_buf);

        sAPI_TaskSleep(MS_TO_TICKS(2000));
    }
}

/* ============================================================================
 * Public Init — called from simcom_application.c
 * ========================================================================= */
void sAPP_MqttBridgeInit(void)
{
    sAPI_Debug("[MQTT] Init...");

    /* Configure MCU UART */
    SCuartConfiguration cfg;
    cfg.BaudRate  = SC_UART_BAUD_115200;
    cfg.DataBits  = SC_UART_WORD_LEN_8;
    cfg.ParityBit = SC_UART_NO_PARITY_BITS;
    cfg.StopBits  = SC_UART_ONE_STOP_BIT;
    sAPI_UartSetConfig(MCU_UART_PORT, &cfg);
    sAPI_UartRegisterCallback(MCU_UART_PORT, McuUartCallback);

    /* Print Boot Info to MCU UART */
    char boot_info[256];
    snprintf(boot_info, sizeof(boot_info),
             "\r\n=================================\r\n"
             "App Name: %s\r\n"
             "Version:  %s\r\n"
             "Compiled: %s %s\r\n"
             "=================================\r\n\r\n",
             APP_NAME_STR, APP_VERSION_STR, __DATE__, __TIME__);
    sAPI_UartWrite(MCU_UART_PORT, (UINT8 *)boot_info, strlen(boot_info));

    /* Message queues */
    sAPI_MsgQCreate(&g_mqtt_urc_msgq, "mqtt_q", sizeof(SIM_MSG_T), MQTT_MSGQ_SIZE, SC_FIFO);
    sAPI_MsgQCreate(&g_mcu_rx_msgq,   "mcu_q",  sizeof(SIM_MSG_T), 16, SC_FIFO);

    /* Connection-lost callback */
    sAPI_MqttConnLostCb(MqttConnLostHandler);

    /* Tasks */
    sAPI_TaskCreate(&g_recvTask, g_recvTaskStack, SC_DEFAULT_THREAD_STACKSIZE * 2,
                    SC_DEFAULT_TASK_PRIORITY, (char *)"mqttRecv", MqttRecvTask, NULL);
    sAPI_TaskCreate(&g_bridgeTask, g_bridgeTaskStack, SC_DEFAULT_THREAD_STACKSIZE * 4,
                    SC_DEFAULT_TASK_PRIORITY, (char *)"mqttBridge", MqttBridgeTask, NULL);
    sAPI_TaskCreate(&g_reporterTask, g_reporterTaskStack, SC_DEFAULT_THREAD_STACKSIZE * 2,
                    SC_DEFAULT_TASK_PRIORITY, (char *)"netReporter", PeriodicReporterTask, NULL);

    sAPI_Debug("[MQTT] Init complete");
}
