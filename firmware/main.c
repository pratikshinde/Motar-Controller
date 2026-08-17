#include "Calibration.h"
#include "Init_Settings.h"
#include "IoT_Comm.h"
#include "LCD.h"
#include "Measurement.h"
#include "MotorProtection.h"
#include "NuMicro.h"
#include "Timer3_Int.h"
#include "UI_Menu.h"
#include "config.h"
#include <stdint.h>
#include <stdio.h>

extern GlobalSettings_t GlobalSettings;

int main(void) {
  // System Initialization
  SYS_Init();
  InitGPIO();
  UART0_Init();
  IoT_Init(); // Initialize UART2 for A7672X communication
  initTimer3();
  Init_Timer1_100ms();
  printf("\r\n========================================\r\n");
  printf("--- System Booting ---\r\n");
  printf("Build Ver: %s\r\n", BUILD_VERSION);
  printf("Compiled: %s %s\r\n", __DATE__, __TIME__);
  printf("========================================\r\n");

  // Peripheral Initialization
  Measurement_Init();
  LCD_Init();

  // Load Settings
  readSettingsEEPROM();

  Calibration_Init();

  // Send device registration to A7672X (will be forwarded to server)
  IoT_SendRegistration();

  // Startup Sequence (Logo & POD State Init)
  UI_PowerOnDelay();

  while (1) {
    Calibration_Check();

    // Periodic check of 3 phases
    Motor_VerifyPhases();

    // Main Motor Logic (State Machine)
    Motor_StateMachine();

    // IoT Communication (non-blocking: parse RX, schedule TX)
    IoT_Process();

    // Button Handling (General)
    static uint32_t save_press_start = 0;
    static uint32_t last_btn_act = 0;
    // Max Amps Limit per HP Setting (Index 0-13)
    // 0:Def, 1:3HP, 2:5HP, 3:7.5HP, 4:10HP, 5:12.5HP, 6:15HP, 7:17.5HP, 8:20HP,
    // 9:25HP, 10:30HP, 11:35HP, 12:40HP, 13:50HP
    static const uint8_t MAX_AMPS_LIMIT[] = {80, 10, 15, 25,  35,  40,  50,
                                             60, 70, 80, 100, 110, 120, 140};
    static const uint8_t MIN_AMPS_LIMIT[] = {2,  3,  5,  8,  15, 20, 30,
                                             35, 40, 50, 50, 50, 50, 50};
    uint16_t btn = UI_ReadButton();

    if (btn == BUTTON_UP) {
      if (getMillis() - last_btn_act > 200) {
        uint8_t hpIdx = GlobalSettings.HP_Settings;
        uint8_t maxLimit = 80; // Default fallback
        if (hpIdx >= HP_SETTING_MIN && hpIdx <= HP_SETTING_MAX) {
          maxLimit = MAX_AMPS_LIMIT[hpIdx];
        }

        if (GlobalSettings.Current_OverLoad < maxLimit) {
          GlobalSettings.Current_OverLoad++;
        }
        last_btn_act = getMillis();
      }
    } else if (btn == BUTTON_DOWN) {
      if (getMillis() - last_btn_act > 200) {
        uint8_t hpIdx = GlobalSettings.HP_Settings;
        uint8_t minLimit = 2; // Default fallback
        if (hpIdx >= HP_SETTING_MIN && hpIdx <= HP_SETTING_MAX) {
          minLimit = MIN_AMPS_LIMIT[hpIdx];
        }

        if (GlobalSettings.Current_OverLoad > minLimit) {
          GlobalSettings.Current_OverLoad--;
        }
        last_btn_act = getMillis();
      }
    } else if (btn == BUTTON_SAVE) {
      if (save_press_start == 0) {
        save_press_start = getMillis();
      } else if ((getMillis() - save_press_start > 3000)) {
        // Long Press -> Enter Settings (From any non-fault state)
        save_press_start = 0;

        // Safety: Stop motor before entering settings
        Motor_Stop();
        state = STATE_STOP;
        if (Motor_ReadAutoStartSw() == 0) {
          UI_SettingsMenu();
        }
      }
    } else {
      // Button Released
      if (save_press_start != 0) {
        // Check Short Press (< 3000ms)
        if (getMillis() - save_press_start < 3000) {
          LCD_Clear();
          LCD_String(1, 0, "Current Settings");
          LCD_String(2, 0, "Saved...        ");
          writeSettingEEPROM();
          Delay_ms(2000);
          LCD_Clear();
        }
        save_press_start = 0; // Reset
      }
    }
  }
}
