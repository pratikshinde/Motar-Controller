#include "IoT_Comm.h"
#include "Init_Settings.h"
#include "Measurement.h"
#include "MotorProtection.h"
#include "Timer3_Int.h"
#include "config.h"
#include "fmc.h"
#include <stdint.h>
#include <stdio.h>
#include <string.h>

// --- External Dependencies ---
extern GlobalSettings_t GlobalSettings;
extern void writeSettingEEPROM(void);

// --- Global State (exported via header) ---
volatile uint8_t iot_motor_on_request = 0;
volatile uint8_t iot_motor_off_request = 0;
volatile uint8_t iot_settings_updated = 0;
volatile IoT_State_t iot_state = IOT_STATE_BOOT;
volatile uint8_t iot_network_connected = 0;
volatile int8_t iot_signal_strength = 0;

// --- UART2 Ring Buffer ---
static volatile char iot_rx_buf[IOT_RX_BUF_SIZE];
static volatile uint16_t iot_rx_head = 0;
static volatile uint16_t iot_rx_tail = 0;
static volatile uint8_t iot_msg_ready = 0;

// --- TX Buffer ---
static char iot_tx_buf[IOT_TX_BUF_SIZE];

// --- Message Processing Buffer (to avoid stack usage) ---
static char iot_msg_buf[IOT_RX_BUF_SIZE];

// --- Timing ---
static uint32_t lastStatusSendMillis = 0;
static uint32_t lastPingSendMillis = 0;
static uint32_t iotBootMillis = 0;
static uint8_t registrationSent = 0;

// ============================================================================
// UART2 Hardware Init
// ============================================================================
static void UART2_Init(void) {
  SYS_UnlockReg();

  // Enable UART2 clock
  CLK->APBCLK0 |= CLK_APBCLK0_UART2CKEN_Msk;

  // Clock source = HIRC, divider = 1
  CLK->CLKSEL3 =
      (CLK->CLKSEL3 & ~CLK_CLKSEL3_UART2SEL_Msk) | CLK_CLKSEL3_UART2SEL_HIRC;
  CLK->CLKDIV4 =
      (CLK->CLKDIV4 & ~CLK_CLKDIV4_UART2DIV_Msk) | CLK_CLKDIV4_UART2(1);

  // MFP: PC0 = UART2_RXD, PC1 = UART2_TXD
  // Note: Named macros (SYS_GPC_MFPL_PC0MFP_UART2_*) don't exist in this BSP.
  // Using raw MFP function value. Verify against your chip datasheet pin table.
  // M031 MFP function 8 = UART2 on PC0/PC1
  SYS->GPC_MFPL =
      (SYS->GPC_MFPL &
       ~(SYS_GPC_MFPL_PC0MFP_Msk | SYS_GPC_MFPL_PC1MFP_Msk)) |
      (0x08ul << SYS_GPC_MFPL_PC0MFP_Pos) | // PC0 = UART2_RXD
      (0x08ul << SYS_GPC_MFPL_PC1MFP_Pos);  // PC1 = UART2_TXD

  SYS_LockReg();

  // Reset UART2
  SYS->IPRST1 |= SYS_IPRST1_UART2RST_Msk;
  SYS->IPRST1 &= ~SYS_IPRST1_UART2RST_Msk;

  // Configure: 115200 baud, 8N1
  UART2->BAUD = UART_BAUD_MODE2 | UART_BAUD_MODE2_DIVIDER(__HIRC, 115200);
  UART2->LINE = UART_WORD_LEN_8 | UART_PARITY_NONE | UART_STOP_BIT_1;

  // Enable RDA interrupt (shares UART02_IRQn with UART0)
  UART2->INTEN |= UART_INTEN_RDAIEN_Msk;
  NVIC_EnableIRQ(UART02_IRQn);
}

// ============================================================================
// UART2 TX (Polling — used from main loop only, not time-critical)
// ============================================================================
static void UART2_SendString(const char *str) {
  while (*str) {
    while (UART2->FIFOSTS & UART_FIFOSTS_TXFULL_Msk)
      ;
    UART2->DAT = *str++;
  }
}

// ============================================================================
// UART2 RX Handler — Called from UART02_IRQHandler (ISR context)
// ============================================================================
void IoT_UART2_RxHandler(char c) {
  uint16_t next_head = (iot_rx_head + 1) % IOT_RX_BUF_SIZE;

  if (next_head != iot_rx_tail) {
    iot_rx_buf[iot_rx_head] = c;
    iot_rx_head = next_head;

    // Message delimiter: newline
    if (c == '\n') {
      iot_msg_ready++;
    }
  }
  // else: buffer full, drop byte
}

// ============================================================================
// Ring Buffer Helpers
// ============================================================================
static uint16_t RxAvailable(void) {
  return (iot_rx_head - iot_rx_tail + IOT_RX_BUF_SIZE) % IOT_RX_BUF_SIZE;
}

static char RxRead(void) {
  if (iot_rx_tail == iot_rx_head)
    return 0;
  char c = iot_rx_buf[iot_rx_tail];
  iot_rx_tail = (iot_rx_tail + 1) % IOT_RX_BUF_SIZE;
  return c;
}

// ============================================================================
// Lightweight JSON Helpers (no malloc)
// ============================================================================

// Find value for a given key in a JSON string. Returns pointer to value start.
// For string values, pointer is AFTER the opening quote.
// For numeric values, pointer is at the first digit/minus.
// Returns NULL if key not found.
static const char *JsonFindKey(const char *json, const char *key) {
  char search[32];
  snprintf(search, sizeof(search), "\"%s\":", key);
  const char *p = strstr(json, search);
  if (!p)
    return NULL;
  p += strlen(search);
  // Skip whitespace
  while (*p == ' ')
    p++;
  return p;
}

// Extract integer value for a key. Returns 1 on success.
static int JsonGetInt(const char *json, const char *key, int *out) {
  const char *p = JsonFindKey(json, key);
  if (!p)
    return 0;
  *out = 0;
  int neg = 0;
  if (*p == '-') {
    neg = 1;
    p++;
  }
  while (*p >= '0' && *p <= '9') {
    *out = (*out * 10) + (*p - '0');
    p++;
  }
  if (neg)
    *out = -(*out);
  return 1;
}

// Extract string value for a key into buf (up to bufSize-1 chars).
// Returns 1 on success.
static int JsonGetStr(const char *json, const char *key, char *buf,
                      int bufSize) {
  const char *p = JsonFindKey(json, key);
  if (!p || *p != '"')
    return 0;
  p++; // skip opening quote
  int i = 0;
  while (*p && *p != '"' && i < bufSize - 1) {
    buf[i++] = *p++;
  }
  buf[i] = '\0';
  return 1;
}

// ============================================================================
// MCU Unique ID Reader
// ============================================================================
static void GetMCU_UID(char *buf, int bufSize) {
  SYS_UnlockReg();
  FMC_Open();
  uint32_t uid0 = FMC_ReadUID(0);
  uint32_t uid1 = FMC_ReadUID(1);
  uint32_t uid2 = FMC_ReadUID(2);
  FMC_Close();
  SYS_LockReg();
  snprintf(buf, bufSize, "%08X%08X%08X", uid0, uid1, uid2);
}

// ============================================================================
// TX Message Builders
// ============================================================================

void IoT_SendRegistration(void) {
  char uid[28];
  GetMCU_UID(uid, sizeof(uid));
  snprintf(iot_tx_buf, IOT_TX_BUF_SIZE,
           "{\"cmd\":\"reg\",\"dev_id\":\"%s\",\"fw\":\"%s\"}\n", uid,
           BUILD_VERSION);
  UART2_SendString(iot_tx_buf);
  registrationSent = 1;
  printf("[IoT] Registration sent: %s\r\n", uid);
}

void IoT_SendStatus(void) {
  snprintf(
      iot_tx_buf, IOT_TX_BUF_SIZE,
      "{\"cmd\":\"status\","
      "\"vl\":[%d,%d,%d],"
      "\"i\":[%d,%d,%d],"
      "\"mot\":%d,\"st\":%d,\"flt\":%d,"
      "\"rt\":%u,\"ol\":%d}\n",
      (int)VRY, (int)VYB, (int)VRB, (int)(Cur_R + 0.5f),
      (int)(Cur_Y + 0.5f), (int)(Cur_B + 0.5f), (int)motorState, state,
      (int)activeFaultCode, (unsigned int)TotalRunTime[0],
      (int)GlobalSettings.Current_OverLoad);
  UART2_SendString(iot_tx_buf);
}

void IoT_SendFault(uint8_t faultCode) {
  static const char *faultNames[] = {
      "None",      "YPhase",   "PhaseLoss", "OverVolt",  "PhaseSeq",
      "DryRun",    "CableAll", "CablePart", "OverLoad",  "Imbalance"};
  const char *desc = "Unknown";
  if (faultCode <= 9)
    desc = faultNames[faultCode];

  snprintf(iot_tx_buf, IOT_TX_BUF_SIZE,
           "{\"cmd\":\"fault\",\"code\":%d,\"desc\":\"%s\","
           "\"vl\":[%d,%d,%d],\"i\":[%d,%d,%d]}\n",
           faultCode, desc, (int)VRY, (int)VYB, (int)VRB,
           (int)(Cur_R + 0.5f), (int)(Cur_Y + 0.5f), (int)(Cur_B + 0.5f));
  UART2_SendString(iot_tx_buf);
  printf("[IoT] Fault sent: %s (%d)\r\n", desc, faultCode);
}

static void IoT_SendPong(void) {
  UART2_SendString("{\"cmd\":\"pong\"}\n");
}

static void IoT_SendAck(const char *ref, uint8_t ok) {
  snprintf(iot_tx_buf, IOT_TX_BUF_SIZE,
           "{\"cmd\":\"ack\",\"ref\":\"%s\",\"ok\":%d}\n", ref, ok);
  UART2_SendString(iot_tx_buf);
}

// ============================================================================
// RX Message Handler
// ============================================================================

// Parse a complete JSON line and act on it
static void IoT_HandleMessage(char *msg) {
  char cmd[16] = {0};

  if (!JsonGetStr(msg, "cmd", cmd, sizeof(cmd))) {
    return; // No cmd field
  }

  // --- net_status: Network connectivity update from A7672X ---
  if (strcmp(cmd, "net_status") == 0) {
    int conn = 0, sig = 0;
    JsonGetInt(msg, "conn", &conn);
    JsonGetInt(msg, "sig", &sig);
    iot_network_connected = (uint8_t)conn;
    iot_signal_strength = (int8_t)sig;

    if (conn && iot_state == IOT_STATE_BOOT) {
      iot_state = IOT_STATE_REGISTERING;
      IoT_SendRegistration();
    }
    printf("[IoT] Network: %s (sig: %d)\r\n", conn ? "UP" : "DOWN", sig);
  }

  // --- reg_ack: Registration acknowledged by server ---
  else if (strcmp(cmd, "reg_ack") == 0) {
    int ok = 0;
    JsonGetInt(msg, "ok", &ok);
    if (ok) {
      iot_state = IOT_STATE_CONNECTED;
      printf("[IoT] Registered OK\r\n");
    }
  }

  // --- motor_cmd: Remote motor ON/OFF ---
  else if (strcmp(cmd, "motor_cmd") == 0) {
    char action[8] = {0};
    JsonGetStr(msg, "action", action, sizeof(action));
    if (strcmp(action, "on") == 0) {
      iot_motor_on_request = 1;
      printf("[IoT] Remote Motor ON\r\n");
    } else if (strcmp(action, "off") == 0) {
      iot_motor_off_request = 1;
      printf("[IoT] Remote Motor OFF\r\n");
    }
    IoT_SendAck("motor_cmd", 1);
  }

  // --- settings: Update UI-accessible settings ---
  else if (strcmp(cmd, "settings") == 0) {
    int val;
    uint8_t changed = 0;

    if (JsonGetInt(msg, "hp", &val)) {
      if (val >= 1 && val <= 13) {
        GlobalSettings.HP_Settings = (uint16_t)val;
        changed = 1;
      }
    }
    if (JsonGetInt(msg, "as", &val)) {
      if (val >= 2 && val <= 600) {
        GlobalSettings.Timing_AutoStart = (uint16_t)val;
        changed = 1;
      }
    }
    if (JsonGetInt(msg, "sd", &val)) {
      if (val >= 1 && val <= 60) {
        GlobalSettings.Timing_StarDeltaDelay = (uint16_t)val;
        changed = 1;
      }
    }
    if (JsonGetInt(msg, "ov", &val)) {
      if (val >= 300 && val <= 600) {
        GlobalSettings.Voltage_Over = (uint16_t)val;
        changed = 1;
      }
    }
    if (JsonGetInt(msg, "dr", &val)) {
      if (val >= 1 && val <= 50) {
        GlobalSettings.Current_DryRun = (uint16_t)val;
        changed = 1;
      }
    }
    if (JsonGetInt(msg, "dr_t", &val)) {
      if (val >= 0 && val <= 25) {
        GlobalSettings.Timing_DryRun = (uint16_t)val;
        changed = 1;
      }
    }
    if (JsonGetInt(msg, "dr_rst", &val)) {
      if (val >= 0 && val <= 250) {
        GlobalSettings.Timing_DryRunReset = (uint16_t)val;
        changed = 1;
      }
    }
    if (JsonGetInt(msg, "imb", &val)) {
      if (val >= 1 && val <= 80) {
        GlobalSettings.Voltage_Imbalance = (uint16_t)val;
        changed = 1;
      }
    }
    if (JsonGetInt(msg, "ar", &val)) {
      if (val == 0 || val == 1) {
        GlobalSettings.AutoRestart = (uint16_t)val;
        changed = 1;
      }
    }
    if (JsonGetInt(msg, "cyc", &val)) {
      if (val == 0 || val == 1) {
        GlobalSettings.CyclicTimer = (uint16_t)val;
        changed = 1;
      }
    }
    if (JsonGetInt(msg, "on_t", &val)) {
      if (val >= 1 && val <= 250) {
        GlobalSettings.Timing_MotOnTime = (uint16_t)val;
        changed = 1;
      }
    }
    if (JsonGetInt(msg, "rst_t", &val)) {
      if (val >= 0 && val <= 250) {
        GlobalSettings.Timing_MotRestartTime = (uint16_t)val;
        changed = 1;
      }
    }
    if (JsonGetInt(msg, "ct", &val)) {
      if (val >= 1 && val <= 50) {
        GlobalSettings.CTRatio = (uint16_t)val;
        changed = 1;
      }
    }
    if (JsonGetInt(msg, "ph", &val)) {
      if (val >= 0 && val <= 15) {
        GlobalSettings.PHRatio = (uint16_t)val;
        changed = 1;
      }
    }
    if (JsonGetInt(msg, "ps", &val)) {
      if (val == 0 || val == 1) {
        GlobalSettings.Voltage_PhaseSequenceCheck = (uint16_t)val;
        changed = 1;
      }
    }
    if (JsonGetInt(msg, "ol", &val)) {
      if (val >= 2 && val <= 140) {
        GlobalSettings.Current_OverLoad = (uint16_t)val;
        changed = 1;
      }
    }

    if (changed) {
      writeSettingEEPROM();
      iot_settings_updated = 1;
      printf("[IoT] Settings updated & saved\r\n");
    }
    IoT_SendAck("settings", changed);
  }

  // --- ping: Heartbeat from A7672X ---
  else if (strcmp(cmd, "ping") == 0) {
    IoT_SendPong();
  }
}

// ============================================================================
// Extract one complete message from ring buffer
// Returns 1 if a message was extracted into `out` (null-terminated)
// ============================================================================
static uint8_t IoT_ExtractMessage(char *out, uint16_t maxLen) {
  uint16_t i = 0;
  uint16_t tail = iot_rx_tail;

  while (tail != iot_rx_head && i < maxLen - 1) {
    char c = iot_rx_buf[tail];
    tail = (tail + 1) % IOT_RX_BUF_SIZE;

    if (c == '\n') {
      out[i] = '\0';
      iot_rx_tail = tail;
      if (iot_msg_ready > 0)
        iot_msg_ready--;
      return 1;
    }
    out[i++] = c;
  }

  // No complete message yet
  return 0;
}

// ============================================================================
// Public API
// ============================================================================

void IoT_Init(void) {
  UART2_Init();
  iot_state = IOT_STATE_BOOT;
  iot_rx_head = iot_rx_tail = 0;
  iot_msg_ready = 0;
  iot_network_connected = 0;
  iot_motor_on_request = 0;
  iot_motor_off_request = 0;
  iot_settings_updated = 0;
  registrationSent = 0;
  lastStatusSendMillis = 0;
  lastPingSendMillis = 0;
  iotBootMillis = getMillis();
  printf("[IoT] Module initialized (UART2 @ 115200)\r\n");
}

uint8_t IoT_IsConnected(void) {
  return (iot_state == IOT_STATE_CONNECTED) && iot_network_connected;
}

void IoT_Process(void) {
  // --- 1. Parse incoming messages ---
  if (iot_msg_ready > 0) {
    if (IoT_ExtractMessage(iot_msg_buf, sizeof(iot_msg_buf))) {
      IoT_HandleMessage(iot_msg_buf);
    }
  }

  // --- 2. Boot timeout: send registration if A7672X hasn't reported yet ---
  if (iot_state == IOT_STATE_BOOT) {
    if (getMillis() - iotBootMillis > IOT_BOOT_TIMEOUT_MS) {
      // Try sending registration anyway (A7672X may already be connected)
      if (!registrationSent) {
        IoT_SendRegistration();
      }
      // Move to disconnected to allow periodic retries
      iot_state = IOT_STATE_DISCONNECTED;
    }
    return; // Don't send telemetry during boot
  }

  // --- 3. Periodic status telemetry ---
  if (iot_state == IOT_STATE_CONNECTED) {
    uint32_t interval = motorState ? IOT_STATUS_INTERVAL_RUN_MS
                                   : IOT_STATUS_INTERVAL_IDLE_MS;

    if (getMillis() - lastStatusSendMillis >= interval) {
      IoT_SendStatus();
      lastStatusSendMillis = getMillis();
    }
  }

  // --- 4. Periodic ping (connection keepalive) ---
  if (iot_state >= IOT_STATE_CONNECTED) {
    if (getMillis() - lastPingSendMillis >= IOT_PING_INTERVAL_MS) {
      UART2_SendString("{\"cmd\":\"heartbeat\"}\n");
      lastPingSendMillis = getMillis();
    }
  }

  // --- 5. Disconnected retry ---
  if (iot_state == IOT_STATE_DISCONNECTED) {
    // Retry registration every boot timeout interval
    static uint32_t lastRetryMillis = 0;
    if (getMillis() - lastRetryMillis > IOT_BOOT_TIMEOUT_MS) {
      IoT_SendRegistration();
      lastRetryMillis = getMillis();
    }
  }
}
