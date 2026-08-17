#ifndef __IOT_COMM_H__
#define __IOT_COMM_H__

#include "NuMicro.h"
#include <stdint.h>

// --- IoT Connection States ---
typedef enum {
  IOT_STATE_BOOT,        // Waiting for A7672X ready
  IOT_STATE_REGISTERING, // Sent registration, awaiting ack
  IOT_STATE_CONNECTED,   // Normal operation
  IOT_STATE_DISCONNECTED // Network lost
} IoT_State_t;

// --- Buffer Sizes ---
#define IOT_RX_BUF_SIZE 256
#define IOT_TX_BUF_SIZE 256

// --- Remote Control Flags (set by RX parser, consumed by Motor State Machine)
// ---
extern volatile uint8_t iot_motor_on_request;
extern volatile uint8_t iot_motor_off_request;
extern volatile uint8_t iot_settings_updated;

// --- Connection State ---
extern volatile IoT_State_t iot_state;
extern volatile uint8_t iot_network_connected;
extern volatile int8_t iot_signal_strength;

// --- Public API ---
void IoT_Init(void);
void IoT_Process(void);
void IoT_SendRegistration(void);
void IoT_SendStatus(void);
void IoT_SendFault(uint8_t faultCode);
uint8_t IoT_IsConnected(void);

// --- Called from UART02_IRQHandler (Calibration.c) ---
void IoT_UART2_RxHandler(char c);

#endif // __IOT_COMM_H__
