#ifndef __CONFIG__
#define __CONFIG__


// Uncomment to restrict HP selection to 3-7.5 HP only (Low Load Mode)
#define ENABLE_LOW_LOAD_SETTINGS

#ifdef ENABLE_LOW_LOAD_SETTINGS
  #define BUILD_VERSION "1.0.367 ***"
  #define HP_SETTING_MIN  1   // Index 1 = 3 HP
  #define HP_SETTING_MAX  4   // Index 4 = 10 HP
#else
  #define BUILD_VERSION "1.0.367"
  #define HP_SETTING_MIN  1   // Index 1 = 3 HP
  #define HP_SETTING_MAX  13  // Index 13 = 50 HP
#endif

// ...
// ...
#define R_VOLTAGE_CORRECTION_FACTOR 1.04f
#define Y_VOLTAGE_CORRECTION_FACTOR 1.03f
#define B_VOLTAGE_CORRECTION_FACTOR 1.03f

#include "NuMicro.h"

// GPIO Pin Definitions
#define SW PA10
#define SW1 PA11
#define LED_RED PA12
#define LED_YEL PA13
#define LED_BLU PA14
#define RELAY PA7
#define RELAY1 PA6

// LCD Pin Definitions
#define PIN_LCD_RS PC14
#define PIN_LCD_EN PB15
#define PIN_LCD_D4 PB14
#define PIN_LCD_D5 PB13
#define PIN_LCD_D6 PB12
#define PIN_LCD_D7 PB7

// Calibration Constants
#define ADC_RATIO_MULTI 0.000805664F
#define VOLTAGE_CALIBRATION_MULTIPLIER 3.2
#define CURRENT_CALIBRATION_MULTIPLIER 0.82

#define VOLTAGE_MULTIPLIER 349 // Final 237V/235V Calib

// Thresholds & Limits
#define COMPARE_VALUE_VOLT_PHASE_LOSS 90.0f
#define COMPARE_VALUE 120
#define COMPARE_ZCD 5
#define COMPARE_DIFF_RY_LOW 6200
#define COMPARE_DIFF_RY_HIGH 7000
#define COMPARE_DIFF_RB_LOW 12800
#define COMPARE_DIFF_RB_HIGH 13600
#define VOLTAGE_OFFSET_VAL 2048
#define JUICE_LINE_COMPARE_VAL 100
#define POD_VAL 10
#define VOLTAGE_ZERO_THRESHOLD 1.0f
#define VOLTAGE_VALID_THRESHOLD 75.0f

// Defines for Timings (in Seconds or Milliseconds)
#define OVERLOAD_TIMEOUT 3   // Seconds
#define IMBALANCE_TIMEOUT 10 // Seconds
#define MOTOR_START_DELAY_MS 500
#define MOTOR_OFF_DELAY_MS 500
#define FAULT_DISPLAY_INIT_MS 1500
#define FAULT_DISPLAY_HOLD_MS 8000
#define TOTAL_RUNTIME_UPDATE_LIMIT 6000
#define DRY_RUN_CHECK_WINDOW_S 30
#define CABLE_OPEN_CURRENT_THRESHOLD 1.3f
#define CABLE_OPEN_LOAD_IMBALANCE 500 // Percent?

// Button ID Definitions
#define BUTTON_SAVE 2
#define BUTTON_NEXT 5
#define BUTTON_PREV 4
#define BUTTON_DOWN 3
#define BUTTON_UP 1
#define BUTTON_NO 0

// UI Button ADC Thresholds
#define BUTTON_ADC_SAMPLE_COUNT 20
#define BUTTON_ADC_SAVE_MIN 1950
#define BUTTON_ADC_SAVE_MAX 2150
#define BUTTON_ADC_NEXT_MIN 2300
#define BUTTON_ADC_NEXT_MAX 2500
#define BUTTON_ADC_PREV_MIN 2650
#define BUTTON_ADC_PREV_MAX 2850
#define BUTTON_ADC_DOWN_MIN 3100
#define BUTTON_ADC_DOWN_MAX 3300
#define BUTTON_ADC_UP_MIN 3450
#define BUTTON_ADC_UP_MAX 3650

#define BUTTON_LONG_PRESS_MS 3000
#define UI_DEBOUNCE_MS 100
#define SETTINGS_SELECT_TIMEOUT 150
#define SETTING_BUTTON_CHK_TIME 100
#define SETTING_BUTTON_REPEAT_DELAY_MS 350
#define SETTING_BUTTON_TOGGLE_DELAY_MS 400
#define SETTING_FAST_REPEAT_THRESHOLD_MS 4000
#define SETTING_FAST_REPEAT_STEP 10
#define SETTINGS_MSG_DISPLAY_TIME_MS 2000
#define POWER_ON_DELAY 3000

// ADC Phase Selection Definitions
#define V_R_PHASE 2
#define V_Y_PHASE 1
#define V_B_PHASE 0
#define C_R_PHASE 5
#define C_Y_PHASE 3
#define C_B_PHASE 4

// ADC Samples
#define BUTTON_STABLE_SAMPLE_COUNT 50
#define ADC_SAMPLES 128 // Reduced to 128 for dynamic offset tracking speed

// IoT Communication (A7672X over UART2)
#define IOT_UART_BAUD 115200
#define IOT_STATUS_INTERVAL_RUN_MS 60000  // 1 min when motor running
#define IOT_STATUS_INTERVAL_IDLE_MS 300000 // 5 min when idle
#define IOT_BOOT_TIMEOUT_MS 15000         // Wait for A7672X ready
#define IOT_PING_INTERVAL_MS 60000        // Heartbeat every 60s

#endif // __CONFIG__