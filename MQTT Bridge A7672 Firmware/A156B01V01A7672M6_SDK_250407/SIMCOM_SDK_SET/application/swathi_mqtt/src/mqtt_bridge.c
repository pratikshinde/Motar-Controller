/**
 * @file    mqtt_bridge.c
 * @brief   MQTT Bridge — M031 MCU ↔ AWS IoT / Generic MQTT
 * @details Uses SIMCOM OpenSDK native sAPI functions.
 */

#include "simcom_api.h"
#include "app_config.h"
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

/* ============================================================================
 * JSON Parser (from M031 IoT_Comm.c)
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

static void McuDebugPrint(const char *fmt, ...)
{
    char buf[256];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    
    char json[320];
    snprintf(json, sizeof(json), "{\"event\":\"log\",\"msg\":\"%s\"}", buf);
    SendToMCU(json);
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
 * SSL Setup (AWS IoT only)
 * ========================================================================= */
#ifdef MQTT_MODE_AWS_IOT
static void SetupSSL(void)
{
    sAPI_SslSetContextIdMsg("sslversion",  MQTT_SSL_CTX_INDEX, "3");
    sAPI_SslSetContextIdMsg("authmode",    MQTT_SSL_CTX_INDEX, "2");
    sAPI_SslSetContextIdMsg("cacert",      MQTT_SSL_CTX_INDEX, AWS_CA_CERT_PATH);
    sAPI_SslSetContextIdMsg("clientcert",  MQTT_SSL_CTX_INDEX, AWS_CLIENT_CERT_PATH);
    sAPI_SslSetContextIdMsg("clientkey",   MQTT_SSL_CTX_INDEX, AWS_CLIENT_KEY_PATH);
    sAPI_Debug("[MQTT] SSL context configured");
}
#endif

/* ============================================================================
 * MQTT Connect / Disconnect / Publish
 * ========================================================================= */
static int MqttConnect(void)
{
    SCmqttReturnCode ret;
    char resolved_ip[32] = {0};
    char final_broker_host[64] = {0};

#ifdef MQTT_MODE_GENERIC
    /* Retry DNS resolution up to 3 times — stack may need a moment after PDP */
    for (int dns_try = 0; dns_try < 3 && strlen(resolved_ip) == 0; dns_try++) {
        McuDebugPrint("DNS attempt %d for %s", dns_try + 1, MQTT_BROKER_DOMAIN);
        SChostent *host_entry = sAPI_TcpipGethostbyname((INT8 *)MQTT_BROKER_DOMAIN);
        if (host_entry != NULL && host_entry->h_addr_list != NULL && host_entry->h_addr_list[0] != NULL) {
            UINT32 ip_val = *(UINT32 *)host_entry->h_addr_list[0];
            INT8 *ip_str = sAPI_TcpipInet_ntoa(ip_val);
            if (ip_str && strlen((char *)ip_str) > 0) {
                snprintf(resolved_ip, sizeof(resolved_ip), "%s", ip_str);
                McuDebugPrint("DNS OK: %s -> %s", MQTT_BROKER_DOMAIN, resolved_ip);
            }
        }
        if (strlen(resolved_ip) == 0) {
            McuDebugPrint("DNS attempt %d failed", dns_try + 1);
            sAPI_TaskSleep(MS_TO_TICKS(2000));
        }
    }

    if (strlen(resolved_ip) > 0) {
        snprintf(final_broker_host, sizeof(final_broker_host), "tcp://%s:%d", resolved_ip, MQTT_BROKER_PORT);
    } else {
        McuDebugPrint("DNS failed, using fallback: %s", MQTT_BROKER_FALLBACK_IP);
        snprintf(final_broker_host, sizeof(final_broker_host), "tcp://%s:%d", MQTT_BROKER_FALLBACK_IP, MQTT_BROKER_PORT);
    }
#else
    snprintf(final_broker_host, sizeof(final_broker_host), "%s", MQTT_BROKER_HOST);
#endif

    McuDebugPrint("MqttStart calling...");
    ret = sAPI_MqttStart(-1);
    McuDebugPrint("MqttStart returned: %d", ret);
    if (ret != SC_MQTT_RESULT_SUCCESS) {
        sAPI_MqttRel(MQTT_CLIENT_INDEX);
        sAPI_MqttStop();
        sAPI_TaskSleep(MS_TO_TICKS(1000));
        ret = sAPI_MqttStart(-1);
        McuDebugPrint("MqttStart retry returned: %d", ret);
        if (ret != SC_MQTT_RESULT_SUCCESS) return -1;
    }

    McuDebugPrint("MqttAccq calling client_id=%s...", g_device_id);
    ret = sAPI_MqttAccq(0, NULL, MQTT_CLIENT_INDEX, g_device_id,
                        MQTT_SERVER_TYPE, g_mqtt_urc_msgq);
    McuDebugPrint("MqttAccq returned: %d", ret);
    if (ret != SC_MQTT_RESULT_SUCCESS) return -1;

    /* Set UTF8 check OFF: (SET, NULL, client_index, config_type=0 "checkUTF8", value=0) */
    ret = sAPI_MqttCfg(SC_MQTT_OP_SET, NULL, MQTT_CLIENT_INDEX, 0, 0);
    McuDebugPrint("MqttCfg(utf8) returned: %d", ret);
    
    /* Set optimeout=30s: (SET, NULL, client_index, config_type=1 "optimeout", value=30) */
    ret = sAPI_MqttCfg(SC_MQTT_OP_SET, NULL, MQTT_CLIENT_INDEX, 1, 30);
    McuDebugPrint("MqttCfg(timeout) returned: %d", ret);

#ifdef MQTT_MODE_AWS_IOT
    ret = sAPI_MqttSslCfg(0, NULL, MQTT_CLIENT_INDEX, MQTT_SSL_CTX_INDEX);
    if (ret != SC_MQTT_RESULT_SUCCESS) return -1;
#endif

    char *user = NULL;
    char *pass = NULL;
    if (strlen(MQTT_USERNAME) > 0) user = MQTT_USERNAME;
    if (strlen(MQTT_PASSWORD) > 0) pass = MQTT_PASSWORD;

    McuDebugPrint("MqttConnect to %s...", final_broker_host);
    ret = sAPI_MqttConnect(0, NULL, MQTT_CLIENT_INDEX, final_broker_host,
                           MQTT_KEEPALIVE_S, MQTT_CLEAN_SESSION,
                           user, pass);
    McuDebugPrint("MqttConnect returned: %d", ret);
    if (ret != SC_MQTT_RESULT_SUCCESS) {
        return -1;
    }

    g_mqtt_connected = 1;
    McuDebugPrint("Connected! Subscribing to %s...", g_topic_commands);

    ret = sAPI_MqttSub(MQTT_CLIENT_INDEX, g_topic_commands,
                       strlen(g_topic_commands), MQTT_QOS_DEFAULT, 0);
    McuDebugPrint("MqttSub returned: %d", ret);

    /* Send successful registration acknowledgement to MCU */
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
 * Route MCU message → MQTT topic
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
        SendRegAck(MqttPublish(g_topic_telemetry, json) == 0 ? 1 : 0);
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
 * MQTT Receive Task — forwards cloud commands to MCU
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

        if (sub->payload_P && sub->payload_len > 0) {
            char *copy = sAPI_Malloc(sub->payload_len + 2);
            if (copy) {
                memcpy(copy, sub->payload_P, sub->payload_len);
                copy[sub->payload_len] = '\0';
                McuDebugPrint("[MQTT] RX Command: %s", copy);
                SendToMCU(copy);
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

    sAPI_Debug("[MQTT] Bridge task started");
    SendNetStatus(0, -999);

    /* Phase 1: Network */
    while (WaitForNetwork() != 0) {
        sAPI_Debug("[MQTT] Retrying network...");
        sAPI_TaskSleep(MS_TO_TICKS(10000));
    }
    SendNetStatus(1, GetSignalDbm());

    /* Phase 2: SSL */
#ifdef MQTT_MODE_AWS_IOT
    SetupSSL();
#endif

    /* Phase 3: Default topics */
    snprintf(g_topic_telemetry, sizeof(g_topic_telemetry), TOPIC_TELEMETRY_FMT, g_device_id);
    snprintf(g_topic_faults,    sizeof(g_topic_faults),    TOPIC_FAULTS_FMT,    g_device_id);
    snprintf(g_topic_commands,  sizeof(g_topic_commands),  TOPIC_COMMANDS_FMT,  g_device_id);

    /* Phase 4: Prepare Main Loop (MQTT connection will be established asynchronously once MCU registers) */
    SendNetStatus(1, GetSignalDbm());
    reconn_delay = MQTT_RECONNECT_BASE_MS;
    last_net_tick = last_ping_tick = sAPI_GetTicks();
    last_reconn_tick = 0; /* Try immediately on registration */

    /* Phase 5: Main loop */
    while (1) {
        UINT32 now = sAPI_GetTicks();

        /* 5a. MCU UART messages */
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

        /* 5b. Periodic net_status */
        if ((now - last_net_tick) >= MS_TO_TICKS(NET_STATUS_REPORT_MS)) {
            SendNetStatus(g_mqtt_connected ? 1 : 0, GetSignalDbm());
            last_net_tick = now;
        }

        /* 5c. Periodic ping */
        if ((now - last_ping_tick) >= MS_TO_TICKS(PING_TO_MCU_MS)) {
            SendPing();
            last_ping_tick = now;
        }

        /* 5d. Connect / Reconnect (only when registered by MCU) */
        if (g_registered && !g_mqtt_connected) {
            if (last_reconn_tick == 0 || (now - last_reconn_tick) >= MS_TO_TICKS(reconn_delay)) {
                McuDebugPrint("Initiating connection...");
                MqttDisconnect();
                sAPI_TaskSleep(MS_TO_TICKS(1000));
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
 * Periodic Reporter Task — prints JSON network update every 2 seconds
 * ========================================================================= */
static void PeriodicReporterTask(void *arg)
{
    (void)arg;
    sAPI_Debug("[REPORTER] Periodic reporter task started");

    /* Configure physical UARTs to 115200 8N1 just in case */
    SCuartConfiguration cfg;
    cfg.BaudRate  = SC_UART_BAUD_115200;
    cfg.DataBits  = SC_UART_WORD_LEN_8;
    cfg.ParityBit = SC_UART_NO_PARITY_BITS;
    cfg.StopBits  = SC_UART_ONE_STOP_BIT;
    sAPI_UartSetConfig(SC_UART, &cfg);
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

        /* Format JSON network update string */
        char json_buf[256];
        snprintf(json_buf, sizeof(json_buf),
                 "{\"event\":\"net_update\",\"cgreg\":%d,\"creg\":%d,\"csq\":%d,\"dbm\":%d,\"mqtt_conn\":%d}\r\n",
                 cgreg, creg, csq, signal_dbm, g_mqtt_connected);

        /* Print JSON to both physical UART1 (SC_UART) and UART2 (SC_UART2) */
        sAPI_UartWrite(SC_UART, (UINT8 *)json_buf, strlen(json_buf));
        sAPI_UartWrite(SC_UART2, (UINT8 *)json_buf, strlen(json_buf));

        /* Print via debug port (USB virtual ports / CATStudio) */
        sAPI_Debug("[REPORTER] %s", json_buf);

        /* Sleep for 2 seconds (400 ticks @ 5ms per tick) */
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
