#include "Calibration.h"
#include "Init_Settings.h"
#include "IoT_Comm.h"
#include "LCD.h"
#include "Measurement.h" // For current readings (VR, Cur_R etc)
#include "NuMicro.h"
#include "Timer3_Int.h" // For getMillis
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern GlobalSettings_t GlobalSettings;

#define CALIB_RX_BUFFER_SIZE 128
#define CALIB_WINDOW_MS (5 * 60 * 1000) // 5 Minutes

static volatile char rx_buffer[CALIB_RX_BUFFER_SIZE];
static volatile uint16_t rx_index = 0;
static volatile uint8_t msg_received = 0;

void Calibration_Init(void) {
  rx_index = 0;
  msg_received = 0;
  memset((void *)rx_buffer, 0, CALIB_RX_BUFFER_SIZE);
}

void UART02_IRQHandler(void) {
  // --- UART2 (IoT / A7672X) ---
  if (UART2->INTSTS & UART_INTSTS_RDAINT_Msk) {
    while ((UART2->FIFOSTS & UART_FIFOSTS_RXEMPTY_Msk) == 0) {
      IoT_UART2_RxHandler((char)(UART2->DAT));
    }
  }

  // --- UART0 (Calibration / Debug) ---
  if (UART0->INTSTS & UART_INTSTS_RDAINT_Msk) {
    // Read all available bytes
    while ((UART0->FIFOSTS & UART_FIFOSTS_RXEMPTY_Msk) == 0) {
      char c = (char)(UART0->DAT);

      if (rx_index < CALIB_RX_BUFFER_SIZE - 1) {
        rx_buffer[rx_index++] = c;
        rx_buffer[rx_index] = '\0';

        // Check for end of JSON (})
        if (c == '}') {
          msg_received = 1;
        }
      } else {
        // Buffer overflow, reset
        rx_index = 0;
      }
    }
  }
}

// Simple JSON parser for {"v_ln":[R,Y,B],"i":[R,Y,B]}
// Returns 1 on success, 0 on failure
static int ParseAndApplyCalibration(char *json) {
  float v_ln[3] = {0};
  float i_ln[3] = {0};
  int parsed_v = 0;
  int parsed_i = 0;

  // Locate "v_ln" array
  char *v_ptr = strstr(json, "\"v_ln\":[");
  if (v_ptr) {
    v_ptr += 8; // Skip "v_ln":["
    v_ln[0] = strtof(v_ptr, &v_ptr);
    if (*v_ptr == ',')
      v_ptr++;
    v_ln[1] = strtof(v_ptr, &v_ptr);
    if (*v_ptr == ',')
      v_ptr++;
    v_ln[2] = strtof(v_ptr, NULL);
    parsed_v = 1;
  }

  // Locate "i" array
  char *i_ptr = strstr(json, "\"i\":[");
  if (i_ptr) {
    i_ptr += 5; // Skip "i":["
    i_ln[0] = strtof(i_ptr, &i_ptr);
    if (*i_ptr == ',')
      i_ptr++;
    i_ln[1] = strtof(i_ptr, &i_ptr);
    if (*i_ptr == ',')
      i_ptr++;
    i_ln[2] = strtof(i_ptr, NULL);
    parsed_i = 1;
  }

  if (parsed_v && parsed_i) {
    // Determine the base multiplier currently being used?
    // Actually, Measurement.c uses:
    // VR = RAW * ADC_VOLT_RATIO * VOLTAGE_MULTIPLIER * Correction_Factor *
    // Calib_Mult We want the FINAL displayed value to match v_ln[x] Current
    // Displayed Value ~= Measured_Value_With_Mult_1 New_Mult = Target /
    // (Measured_Value_With_Mult_1)

    // BUT, we have existing multipliers.
    // Simpler approach: New_Mult = Target / (Current_Displayed / Old_Mult)
    // OR: New_Mult = Old_Mult * (Target / Current_Displayed)

    // Voltage R
    if (VR > 5.0f && v_ln[0] > 5.0f) {
      GlobalSettings.CalibMult_Voltage_R *= (v_ln[0] / VR);
    }
    // Voltage Y
    if (VY > 5.0f && v_ln[1] > 5.0f) {
      GlobalSettings.CalibMult_Voltage_Y *= (v_ln[1] / VY);
    }
    // Voltage B
    if (VB > 5.0f && v_ln[2] > 5.0f) {
      GlobalSettings.CalibMult_Voltage_B *= (v_ln[2] / VB);
    }

    // Current R
    if (Cur_R > 0.1f && i_ln[0] > 0.0f) { // Allow 0 calibration? No, unsafe.
                                          // User wants to match reading.
      GlobalSettings.CalibMult_Current_R *= (i_ln[0] / Cur_R);
    }
    // Current Y
    if (Cur_Y > 0.1f && i_ln[1] > 0.0f) {
      GlobalSettings.CalibMult_Current_Y *= (i_ln[1] / Cur_Y);
    }
    // Current B
    if (Cur_B > 0.1f && i_ln[2] > 0.0f) {
      GlobalSettings.CalibMult_Current_B *= (i_ln[2] / Cur_B);
    }

    // Check sanity (0.5 to 2.0 range?) - Optional

    writeSettingEEPROM();
    return 1;
  }
  return 0;
}

void Calibration_Check(void) {
  if (getMillis() > CALIB_WINDOW_MS) {
    // Disable UART interrupt to save resources?
    // Or just ignore. Ignoring is safer.
    // Reset buffer to prevent stuck state
    if (rx_index > 0)
      rx_index = 0;
    return;
  }

  if (msg_received) {
    // Process message
    if (ParseAndApplyCalibration((char *)rx_buffer)) {
      printf("{\"calibration\": \"OK\"}\r\n");
      // Visual Feedback
      LCD_Clear();
      LCD_String(1, 0, "Calibration OK  ");
      LCD_String(2, 0, "Settings Saved  ");
      Delay_ms(5000);
      LCD_Clear();
    } else {
      // Valid JSON not found or parsing error
      // printf("{\"error\": \"Invalid Format\"}\r\n");
    }

    // Clear buffer
    memset((void *)rx_buffer, 0, CALIB_RX_BUFFER_SIZE);
    rx_index = 0;
    msg_received = 0;
  }
}
