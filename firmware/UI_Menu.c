#include "UI_Menu.h"
#include "LCD.h"
#include "Measurement.h"
#include "MotorProtection.h"
#include "SettingsEEPROM.h"
#include "Timer3_Int.h"
#include "config.h"
#include <stdio.h>
#include <string.h>

// Global Variables
uint32_t saveButtonPressMillis = 0;
uint32_t saveButtonPressFlag = 0;
int displayChangeCount = 0;
uint8_t displayCyclicTimerFlag = 0;

// External Dependencies
extern GlobalSettings_t GlobalSettings;
extern uint32_t TotalRunTime[2];
extern uint32_t lastMotorOnCycleMinutes;

// --- Helper Functions ---
static const uint8_t MAX_AMPS_LIMIT[] = {80, 10, 15, 25,  35,  40,  50,
                                         60, 70, 80, 100, 110, 120, 140};
// Helper to map ADC value to Button ID
uint16_t GetButtonFromADC(uint32_t adcVal) {
  if ((adcVal > BUTTON_ADC_SAVE_MIN) && (adcVal < BUTTON_ADC_SAVE_MAX))
    return BUTTON_SAVE;
  else if ((adcVal > BUTTON_ADC_NEXT_MIN) && (adcVal < BUTTON_ADC_NEXT_MAX))
    return BUTTON_NEXT;
  else if ((adcVal > BUTTON_ADC_PREV_MIN) && (adcVal < BUTTON_ADC_PREV_MAX))
    return BUTTON_PREV;
  else if ((adcVal > BUTTON_ADC_DOWN_MIN) && (adcVal < BUTTON_ADC_DOWN_MAX))
    return BUTTON_DOWN;
  else if ((adcVal > BUTTON_ADC_UP_MIN) && (adcVal < BUTTON_ADC_UP_MAX))
    return BUTTON_UP;
  else
    return BUTTON_NO;
}

uint16_t UI_ReadButton(void) {
  uint16_t i;
  uint32_t adcVal = 0;
  uint16_t detectedBtn = BUTTON_NO;
  uint16_t candidateBtn = BUTTON_NO;

  for (i = 0; i < BUTTON_STABLE_SAMPLE_COUNT; i++) {
    ADC->ADCR |= ADC_ADCR_ADST_Msk;
    ADC->ADCHER =
        (ADC->ADCHER & (~ADC_ADCHER_CHEN_Msk)) | (BIT3 | BIT4 | BIT5 | BIT6);
    while (!(ADC->ADSR0 & ADC_ADSR0_ADF_Msk))
      ;
    ADC->ADSR0 = ADC_ADSR0_ADF_Msk;
    adcVal = (ADC->ADDR[6] & ADC_ADDR_RSLT_Msk);

    candidateBtn = GetButtonFromADC(adcVal);

    if (i == 0) {
      detectedBtn = candidateBtn;
    } else {
      if (candidateBtn != detectedBtn) {
        return BUTTON_NO; // Instability detected
      }
    }
    CLK_SysTickDelay(100);
  }

  return detectedBtn;
}

// --- Menu Optimization Definitions ---

typedef enum { NAV_CONTINUE = 0, NAV_NEXT, NAV_PREV, NAV_SAVE_EXIT } NavAction;

typedef enum {
  TYPE_INT,         // Generic Integer
  TYPE_HP,          // HP Settings (Special mapping)
  TYPE_TOGGLE,      // Disabled/Enabled
  TYPE_VOLT,        // 000 Volts
  TYPE_AMP,         // 00 Amps
  TYPE_DRY_RUN_AMP, // 00 Amps (Wraps to 10)
  TYPE_SEC,         // 00 sec
  TYPE_MIN,         // 00 mins
  TYPE_PERCENT,     // 00 %
  TYPE_CT_RATIO,    // x/100 (Wraps to Min)
  TYPE_PH_RATIO     // x Percent
} SettingType;

// HP Value Mapping
static const float HP_VALUES[] = {0.0,  3.0,  5.0,  7.5,  10.0, 12.5, 15.0,
                                  17.5, 20.0, 25.0, 30.0, 35.0, 40.0, 50.0};

// Generic Setting Handler
NavAction RunSetting(void *valPtr, uint16_t min, uint16_t max,
                     uint8_t settingNum, uint8_t fastRepeat, const char *title,
                     SettingType type) {
  static uint32_t setting_milis = 0;
  static uint8_t init = 1;
  static uint8_t needs_update = 1;
  static uint32_t buttonHoldStartMillis = 0;
  static uint16_t lastButton = BUTTON_NO;
  uint16_t step = 1;
  char str[17] = {0};
  uint16_t sw_val;
  uint16_t *u16Ptr = (uint16_t *)valPtr;
  if (*u16Ptr < min)
    *u16Ptr = min;
  if (*u16Ptr > max)
    *u16Ptr = max;

  if (init) {
    // setting_milis no longer needed for throttle
    init = 0;
    saveButtonPressFlag = 0;
    needs_update = 1;
    lastButton = BUTTON_NO;
    buttonHoldStartMillis = 0;
  }

  // Continuous Button Check (removed throttle)
  sw_val = UI_ReadButton();

  // --- Input Handling ---
  if (sw_val == BUTTON_UP || sw_val == BUTTON_DOWN) {
    if (sw_val != lastButton) {
      buttonHoldStartMillis = getMillis();
      lastButton = sw_val;
      step = 1;
    } else {
      if (fastRepeat && (getMillis() - buttonHoldStartMillis >
                         SETTING_FAST_REPEAT_THRESHOLD_MS)) {
        step = SETTING_FAST_REPEAT_STEP;
      } else {
        step = 1;
      }
    }

    if (sw_val == BUTTON_UP) {
      if (max - *u16Ptr < step)
        *u16Ptr = max;
      else
        *u16Ptr += step;

      // Special Wrapping Logic (redundant with clamping but kept for safety)
      if (type == TYPE_CT_RATIO && *u16Ptr > max) {
        *u16Ptr = max;
      } else if (type == TYPE_DRY_RUN_AMP && *u16Ptr > max) {
        *u16Ptr = max;
      }
      // Generic Clamping
      else if (*u16Ptr > max) {
        *u16Ptr = max;
      }
    } else { // BUTTON_DOWN
      if (*u16Ptr - min < step)
        *u16Ptr = min;
      else
        *u16Ptr -= step;
    }

    Delay_ms(type == TYPE_TOGGLE ? SETTING_BUTTON_TOGGLE_DELAY_MS
                                 : SETTING_BUTTON_REPEAT_DELAY_MS);
  } else if (sw_val == BUTTON_NEXT) {
    lastButton = BUTTON_NO;
    Delay_ms(SETTING_BUTTON_REPEAT_DELAY_MS);
    init = 1; // Reset for next screen
    needs_update = 1;
    return NAV_NEXT;
  } else if (sw_val == BUTTON_PREV) {
    Delay_ms(SETTING_BUTTON_REPEAT_DELAY_MS);
    init = 1;
    needs_update = 1;
    return NAV_PREV;
  } else if (sw_val == BUTTON_SAVE) {
    if (!saveButtonPressFlag) {
      saveButtonPressFlag = 1;
      saveButtonPressMillis = getMillis();
    }
    if (getMillis() - saveButtonPressMillis > BUTTON_LONG_PRESS_MS) {
      init = 1;
      needs_update = 1;
      lastButton = BUTTON_NO;
      return NAV_SAVE_EXIT;
    }
  } else {
    saveButtonPressFlag = 0;
    lastButton = BUTTON_NO;
    buttonHoldStartMillis = 0;
  }

  // --- Logic Updates ---
  // --- Logic Updates ---
  // Special Logic for HP
  if (type == TYPE_HP) {
    if (*u16Ptr < HP_SETTING_MIN)
      *u16Ptr = HP_SETTING_MIN;
    if (*u16Ptr > HP_SETTING_MAX)
      *u16Ptr = HP_SETTING_MAX;
    float hp = HP_VALUES[*u16Ptr];
    // GlobalSettings.Current_OverLoad = (uint16_t)(hp * 2.2 + 1);
    GlobalSettings.Current_OverLoad = MAX_AMPS_LIMIT[*u16Ptr];
  }

  // Check if new value requires update (or if forced by init/button press)
  // Actually simpler: if button pressed (UP/DOWN), set needs_update.
  if (sw_val == BUTTON_UP || sw_val == BUTTON_DOWN) {
    needs_update = 1;
  }

  // --- Display Updates ---
  if (needs_update) {
    // LCD_Clear(); // Removed to prevent clearing in configuration

    // Line 1: Title
    if (settingNum != 0)
      snprintf(str, sizeof(str), "%d)%s", settingNum, title);
    else
      snprintf(str, sizeof(str), "%s", title);

    {
      int len = strlen(str);
      while (len < 16 && len < sizeof(str) - 1) {
        str[len++] = ' ';
      }
      str[len] = '\0';
    }
    LCD_String(1, 0, str);

    // Line 2: Value
    switch (type) {
    case TYPE_HP:
      // Special check for display formatting
      if (*u16Ptr == 3 || *u16Ptr == 5 ||
          *u16Ptr == 7) // Indices 3,5,7 -> 7.5, 12.5, 17.5
        snprintf(str, sizeof(str), "    %.1f HP  ", HP_VALUES[*u16Ptr]);
      else
        snprintf(str, sizeof(str), "    %d HP  ", (int)HP_VALUES[*u16Ptr]);
      break;
    case TYPE_INT:
      snprintf(str, sizeof(str), "   %d", *u16Ptr);
      break;
    case TYPE_AMP:
    case TYPE_DRY_RUN_AMP:
      snprintf(str, sizeof(str), "    %d of Amps ", *u16Ptr);
      break;
    case TYPE_VOLT:
      snprintf(str, sizeof(str), "   %03d Volts ", *u16Ptr);
      break;
    case TYPE_SEC:
      snprintf(str, sizeof(str), "   %02d sec ", *u16Ptr);
      break;
    case TYPE_MIN:
      if (strcmp(title, " Set on Time.") == 0)
        snprintf(str, sizeof(str), "Time: %02d Mins", *u16Ptr);
      else if (strcmp(title, "Set Restart Time") == 0 && *u16Ptr != 0)
        snprintf(str, sizeof(str), "Time: %02d Mins", *u16Ptr);
      else if (strcmp(title, "Set Restart Time") == 0 && *u16Ptr == 0)
        snprintf(str, sizeof(str), "  Restart OFF");
      else
        snprintf(str, sizeof(str), "   %02d Mins ", *u16Ptr);
      break;
    case TYPE_TOGGLE:
      snprintf(str, sizeof(str), "%s",
               (*u16Ptr) ? "    Enabled....." : "    Disabled....");
      break;
    case TYPE_PERCENT:
      snprintf(str, sizeof(str), "    %02d%% of Im ", *u16Ptr);
      break;
    case TYPE_PH_RATIO:
      snprintf(str, sizeof(str), "    %d Percent", *u16Ptr);
      break;
    case TYPE_CT_RATIO:
      snprintf(str, sizeof(str), "    %d/100", *u16Ptr);
      break;
    }

    {
      int len = strlen(str);
      while (len < 16 && len < sizeof(str) - 1) {
        str[len++] = ' ';
      }
      str[len] = '\0';
    }
    LCD_String(2, 0, str);
    needs_update = 0;
  }
  return NAV_CONTINUE;
}

// When Star/Delta is hidden, shift display numbers down by 1
#ifdef ENABLE_LOW_LOAD_SETTINGS
  #define SD_OFFSET 1
#else
  #define SD_OFFSET 0
#endif

void UI_SettingsMenu(void) {
  uint32_t setting_milis;
  uint8_t state = 1; // Start at 1
  NavAction action = NAV_CONTINUE;

  // Enter Settings Animation
  LCD_Clear();
  LCD_String(1, 0, "Settings Mode");
  LCD_String(2, 0, "Press Key to Con");
  Delay_ms(SETTINGS_MSG_DISPLAY_TIME_MS);

  // Wait for SAVE release
  while (UI_ReadButton() == BUTTON_SAVE)
    ;

  while (state != 0) {
    switch (state) {
    case 1: // HP Settings (Restored)
      action = RunSetting(&GlobalSettings.HP_Settings, HP_SETTING_MIN, HP_SETTING_MAX, 0, 0,
                          "  HP Settings", TYPE_HP);
      break;
    case 2: // Autostart Timeout
      action = RunSetting(&GlobalSettings.Timing_AutoStart, 2, 600, 1, 1,
                          "AutoStart Dly:3P", TYPE_SEC);
      break;
    case 3: // Star Delta
      action = RunSetting(&GlobalSettings.Timing_StarDeltaDelay, 1, 60, 2, 0,
                          "Star/Delta Dly", TYPE_SEC);
      break;
    case 4: // Over Voltage
      action = RunSetting(&GlobalSettings.Voltage_Over, 300, 600, 3 - SD_OFFSET, 1,
                          "Over Voltage", TYPE_VOLT);
      break;
    case 5: // Dry Run Current
      action = RunSetting(&GlobalSettings.Current_DryRun, 1, 50, 4 - SD_OFFSET, 0,
                          "Dry Run Trip", TYPE_DRY_RUN_AMP);
      break;
    case 6: // Dry Run Timeout
      action = RunSetting(&GlobalSettings.Timing_DryRun, 0, 25, 5 - SD_OFFSET, 0,
                          "DryRun TripDly", TYPE_SEC);
      break;
    case 7: // Dry Run Reset
      action = RunSetting(&GlobalSettings.Timing_DryRunReset, 0, 250, 6 - SD_OFFSET, 1,
                          "DryRun Restart", TYPE_MIN);
      break;
    case 8: // Imbalance
      action = RunSetting(&GlobalSettings.Voltage_Imbalance, 1, 80, 7 - SD_OFFSET, 0,
                          "Unbalance Trip", TYPE_PERCENT);
      break;
    case 9: // Auto Restart / Phase Seq
      action =
          RunSetting(&GlobalSettings.AutoRestart, 0, 1, 8 - SD_OFFSET, 0, " Auto Restart",
                     TYPE_TOGGLE);
      break;
    case 10: // Cyclic Timer
      action =
          RunSetting(&GlobalSettings.CyclicTimer, 0, 1, 9 - SD_OFFSET, 0, " Cyclic Timer",
                     TYPE_TOGGLE);
      break;
    case 11: // Mot On Time
      action = RunSetting(&GlobalSettings.Timing_MotOnTime, 1, 250, 10 - SD_OFFSET, 1,
                          " Set on Time.", TYPE_MIN);
      break;
    case 12: // Mot Restart Time
      action = RunSetting(&GlobalSettings.Timing_MotRestartTime, 0, 250, 0, 1,
                          "Set Restart Time", TYPE_MIN);
      break;
    case 13: // CT Ratio
      action = RunSetting(&GlobalSettings.CTRatio, 1, 50, 11 - SD_OFFSET, 0, " **CT Ratio**",
                          TYPE_CT_RATIO);
      break;
    case 14: // PH Ratio
      action = RunSetting(&GlobalSettings.PHRatio, 0, 15, 12 - SD_OFFSET, 0, " **PH Ratio**",
                          TYPE_PH_RATIO);
      break;
    case 15: // Phase Seq Check
      action = RunSetting(&GlobalSettings.Voltage_PhaseSequenceCheck, 0, 1, 0, 0,
                          " PH Rev Protect", TYPE_TOGGLE);
      break;
    default:
      state = 1; // Loop back
      break;
    }

    if (action == NAV_NEXT) {
      state++;
#ifdef ENABLE_LOW_LOAD_SETTINGS
      if (state == 3) {
        state++; // Skip Star/Delta Delay
      }
#endif
    } else if (action == NAV_PREV) {
      state--;
#ifdef ENABLE_LOW_LOAD_SETTINGS
      if (state == 3) {
        state--; // Skip Star/Delta Delay
      }
#endif
    } else if (action == NAV_SAVE_EXIT) {
      state = 0;
      break;
    }

    // Boundary Checks
    if (state < 1)
      state = 1;
    if (state > 15)
      break;
  }

  // Save and Exit
  LCD_Clear();
  LCD_String(1, 0, "Exit Settings   ");
  LCD_String(2, 0, "Memory Saved   ");
  writeSettingEEPROM();
  Delay_ms(SETTINGS_MSG_DISPLAY_TIME_MS);
}

// --- Rest of File (LCD functions) ---

// Non-blocking Power On Delay Init
uint32_t UI_PowerOnDelay(void) {
  // Just initialize the LCD and let the main loop handle the delay state
  LCD_Clear();
  LCD_String(1, 0, " *** AJANTA ***");
  LCD_String(2, 0, "-Control Panels-");
  return 0; // Return value not really used in main
}

void UI_BootPhaseCheck(void) {
  // Read Voltages and check sequence
  Measurement_ReadVoltage();
  for (int i = 0; i < 6; i++) {
    Measurement_CalcPhaseSequence();
  }
  LED_RED = LED_YEL = LED_BLU = 1; // Turn off LEDs (Active High: 0=OFF)
  if (yPhaseLossFlag) {
    // We used to block here for 5s. Removed to speed up boot.
    // The state machine will handle the fault display in STATE_FAULT after POD
    // ends.
    LED_RED = LED_BLU = 1; // Turn off LEDs (Active High: 0=OFF)
    LED_YEL = 0;           // Turn off LEDs (Active High: 0=OFF)
  }
}

void UI_DisplayParameters(uint8_t line) {
  static uint32_t lastUpdateMillis = 0;
  static uint32_t lastPageSwitchMillis = 0;
  char line_1[17] = {0};
  char line_2[17] = {0};
  char ph_str[3] = {0};
  static char prev_ph_str[3] = {0};
  int force_update = 0;

  int active_phases = 0;
  if (Cur_R > 0.0f || VR > 75.0f)
    active_phases++; // Using Voltage > 75V usually
  if (Cur_Y > 0.0f || VY > 75.0f)
    active_phases++;
  if (Cur_B > 0.0f || VB > 75.0f)
    active_phases++;
  // Or stick to voltage check solely as per user preference (usually voltage)
  active_phases = 0;
  if (VR > COMPARE_VALUE_VOLT_PHASE_LOSS)
    active_phases++;
  if (VY > COMPARE_VALUE_VOLT_PHASE_LOSS)
    active_phases++;
  if (VB > COMPARE_VALUE_VOLT_PHASE_LOSS)
    active_phases++;

  uint8_t seqStat = Measurement_CheckPhaseSequenceFlag();

  // Priority logic for UI Phase display
  if (active_phases <= 1) {
    strcpy(ph_str, "1p");
  } else if (ph_RatioFlag >= 5 || seqStat == 3) {
    strcpy(ph_str, "1p"); // Juice line / Overlap
  } else if (active_phases == 2) {
    strcpy(ph_str, "2p");
  } else {
    strcpy(ph_str, "3p"); // Confident 3-Phase or Settling with 3-Phases
  }

  if (strcmp(ph_str, prev_ph_str) != 0) {
    force_update = 1;
    strcpy(prev_ph_str, ph_str);
  }

  // Throttle updates to ~1000ms to avoid LCD flicker, unless forced
  if ((getMillis() - lastUpdateMillis < 500) && !force_update) {
    return;
  }
  lastUpdateMillis = getMillis();

  // Switch pages every 5000ms (5 seconds)
  if (getMillis() - lastPageSwitchMillis > 4000) {
    displayCyclicTimerFlag = !displayCyclicTimerFlag;
    lastPageSwitchMillis = getMillis();
  }

  // Phase string calculation moved up for change detection

  snprintf(line_1, sizeof(line_1), "%02d,%02d,%02d (%02d) %s",
           (int)(Cur_R + 0.5f), (int)(Cur_Y + 0.5f), (int)(Cur_B + 0.5f),
           (int)GlobalSettings.Current_OverLoad, ph_str);

  if (displayCyclicTimerFlag == 0) {
    snprintf(line_2, sizeof(line_2), "%03d,%03d,%03d %s", (int)VRY, (int)VYB,
             (int)VRB, motorState ? "ON " : "OFF ");
  } else {
    // Page 2 Logic (Timers)
    if (GlobalSettings.CyclicTimer && (state != STATE_FAULT) && autoStartFlag) {
      if (motorState)
        snprintf(line_2, sizeof(line_2), "Stop in %u Min    ",
                 Motor_GetOnRemainingTime());
      else if (Motor_GetOffRemainingTime() && (state == STATE_RESET))
        snprintf(line_2, sizeof(line_2), "Restart in %uMin   ",
                 Motor_GetOffRemainingTime());
      else
        snprintf(line_2, sizeof(line_2), "TT-%02u:%02u, %02u:%02u   ",
                 TotalRunTime[0] / 60, TotalRunTime[0] % 60,
                 lastMotorOnCycleMinutes / 60, lastMotorOnCycleMinutes % 60);
    } else {
      if (motorState) {
        snprintf(line_2, sizeof(line_2), "RT-%02u:%02u           ",
                 Motor_GetOnTimerSinceLastStart() / 60,
                 Motor_GetOnTimerSinceLastStart() % 60);
      } else {
        // Default to Total Time for any other state (including
        // overVoltageFlag=1 in Idle)
        snprintf(line_2, sizeof(line_2), "TT-%02u:%02u, %02u:%02u   ",
                 TotalRunTime[0] / 60, TotalRunTime[0] % 60,
                 lastMotorOnCycleMinutes / 60, lastMotorOnCycleMinutes % 60);
      }
    }
  }

  if (line == 1)
    LCD_String(1, 0, line_1);
  else if (line == 2)
    LCD_String(2, 0, line_2);
  else {
    LCD_String(1, 0, line_1);
    LCD_String(2, 0, line_2);
  }
}
