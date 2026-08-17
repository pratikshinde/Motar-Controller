// Force Rebuild
#include "MotorProtection.h"
#include "IoT_Comm.h"       // For remote control flags and fault notification
#include "LCD.h"            // For LCD display
#include "Measurement.h"    // For voltage/current values
#include "SettingsEEPROM.h" // For Write_RunTime_To_Flash
#include "Timer3_Int.h"     // For getMillis
#include "UI_Menu.h"
#include "config.h"
#include <math.h> // For fabs
#include <stdio.h>
#include <string.h>

// Global Variables
int state = STATE_POWER_ON_DELAY;
uint32_t motorState = 0;
uint8_t autoStartFlag = 0;
uint8_t pumpOnFlag = 0;
uint8_t motorOnManualFlag = 0;
uint8_t motorOffManualFlag = 0;
uint8_t faultDetetctedAtIdleFlag = 0;
uint8_t voltage_fault = 0;
uint8_t current_fault = 0;
uint8_t activeFaultCode = FAULT_NONE;
uint8_t phase_seq_fault = 0;
uint8_t cableopenFlag = 0;
uint8_t dryRunCheckInitFlag = 0;
uint8_t overloadInitFlag = 0;
uint8_t imbalanceDetectFlag = 0;
int16_t dryRunResetMins = 0;
uint16_t completedMinutesInCurrentCycle = 0;
uint32_t TotalRunTime[2] = {0};
uint32_t prevRunMinutes = 0;
uint32_t lastMotorOnCycleMinutes = 0;

uint32_t motorOnMillis = 0;
uint32_t motorOffMillis = 0;
uint32_t autoStartMillis = 0;
uint32_t dryRunCheckMillis = 0;
uint32_t overloadInitMillis = 0;
uint32_t imbalanceDetectMillis = 0;
uint32_t faultInitMillis = 0;
uint32_t dryrunResetMillis = 0;
uint32_t voltageErrorDisplayMillis = 0;

uint8_t prevAutoStartFlag = 0;
uint8_t autoStartBeginFlag = 0;
uint8_t faultInitFlag = 0;
uint8_t dryRunResetInitFlag = 0;
uint8_t displayForceInitFlag = 1;
uint8_t prevRunMinutesFlag = 0;
uint8_t voltageErrorFlag = 0;
int remainingOnTime; // Was declared in Init_Settings.c without static/extern,
                     // assumed global

// LCD State definitions for non-blocking init
#define LCD_STATE_IDLE 0
#define LCD_STATE_PENDING_START 1
#define LCD_STATE_PENDING_STOP 2

uint8_t lcdState = LCD_STATE_IDLE;

// External dependencies
extern GlobalSettings_t GlobalSettings;
extern uint16_t UI_ReadButton(void);
extern void UI_DisplayParameters(uint8_t line);
extern uint32_t saveButtonPressFlag; // Used in motorLoop?? No, seemed to be
                                     // used in configuration.
extern uint32_t saveButtonPressMillis;

// Check if these are needed here
// They were used in motorLoop for IDLE state button checking
// verify readButton constants
#ifndef BUTTON_SAVE
#define BUTTON_SAVE 2
#define BUTTON_NEXT 5
#define BUTTON_PREV 4
#define BUTTON_DOWN 3
#define BUTTON_UP 1
#define BUTTON_NO 0
#endif

void Motor_VerifyPhases(void) {
  // --- 1. Power-On Delay Isolation Block ---
  // During POD (13s countdown), we ONLY handle basic blinking and voltage
  // reading. This prevents fault-logic (like yPhaseError) from interfering with
  // boot feedback.
  if (state == STATE_POWER_ON_DELAY) {
    static uint32_t pod_led_millis = 0;
    static uint8_t pod_led_state = 0;
    static uint32_t last_pod_volt_read = 0;

    // A. Throttled Voltage Read (for countdown display/logs)
    if (getMillis() - last_pod_volt_read > 1000) {
      Measurement_ReadVoltage();
      last_pod_volt_read = getMillis();
    }

    // B. Synced Blinking (100ms)
    if (getMillis() - pod_led_millis >= 100) {
      pod_led_millis = getMillis();
      pod_led_state = !pod_led_state;
    }
    LED_RED = LED_BLU = pod_led_state;

    // Direct PA13 control for Yellow LED - Ensuring hardware drive
    if (pod_led_state)
      PA->DOUT |= (1 << 13);
    else
      PA->DOUT &= ~(1 << 13);

    return; // EXIT EARLY - No other logic should run during POD
  }

  // --- 2. Normal Operation Logic (Post-POD) ---
  static uint8_t last_phaseloss_state = 0;
  static uint32_t sequence_check_timeout = 10000;
  static uint32_t sequence_check_start = 0;
  static uint8_t motor_init_done = 0;
  static uint32_t lastVoltRead = 0;
  static uint32_t lastPhaseCheck = 0;
  static uint32_t yPhaseLossStartMillis = 0;

  if (!motor_init_done) {
    sequence_check_start = getMillis();
    motor_init_done = 1;
  }

  Measurement_ReadVoltage();
  Measurement_ReadCurrent();

  // Re-trigger sequence check if phase loss is recovered
  if (last_phaseloss_state != 0 && phaseloss_flag == 0) {
    sequence_check_start = getMillis();
    sequence_check_timeout = 10000;
  }
  last_phaseloss_state = phaseloss_flag;

  // Measurement Logic (Throttled)
  uint8_t currentSeq = Measurement_CheckPhaseSequenceFlag();
  uint32_t throttle = 5000;
  if (getMillis() < 30000 || currentSeq != 1 || yPhaseLossFlag ||
      phase_seq_fault) {
    throttle = 500;
  }

  if (getMillis() - lastPhaseCheck >= throttle) {
    Measurement_CalcPhaseSequence();
    lastPhaseCheck = getMillis();
  }

  // Unified Voltage-Based Fault Recovery
  if (VR > 100.0f && VY > 100.0f && VB > 100.0f && ph_RatioFlag < 10) {
    yPhaseLossFlag = 0;
    yPhaseError = 0;
    phaseloss_flag = 0;
  }

  // Fault Detection
  uint8_t seqStatus = Measurement_CheckPhaseSequenceFlag();
  if (seqStatus != 1) {
    if (seqStatus == 0)
      phase_seq_fault = 1;
    else if (seqStatus == 2 && yPhaseLossFlag)
      yPhaseError = 1;
    else if (seqStatus == 3 && ph_RatioFlag >= 5) {
      yPhaseLossFlag = 1;
      yPhaseError = 1;
    }
  } else {
    phase_seq_fault = 0;
  }

  // --- 3. LED Management (Post-POD) ---
  // A. Yellow LED
  if (yPhaseLossFlag) {
    if (yPhaseLossStartMillis == 0)
      yPhaseLossStartMillis = getMillis();
    if (getMillis() - yPhaseLossStartMillis < 8000) {
      if (!yPhaseTimerInitFlag) {
        Timer1_Enable();
        yPhaseTimerInitFlag = 1;
      }
    } else {
      if (yPhaseTimerInitFlag) {
        Timer1_Disable();
        yPhaseTimerInitFlag = 0;
      }
      LED_YEL = 0;
    }
  } else {
    yPhaseLossStartMillis = 0;
    if (yPhaseTimerInitFlag) {
      Timer1_Disable();
      yPhaseTimerInitFlag = 0;
    }
    LED_YEL = (yPhaseError) ? 0 : 1;
  }

  // B. Red & Blue LEDs
  LED_RED = (VR > VOLTAGE_VALID_THRESHOLD) ? 1 : 0;
  LED_BLU = (VB > VOLTAGE_VALID_THRESHOLD) ? 1 : 0;
}

void Motor_Start(void) {
  RELAY = 1;
  motorState = 1;
  motorOnMillis = getMillis();
  prevRunMinutes = 0;
  // Don't reset completedMinutesInCurrentCycle here.
  // It is either restored from flash (resume after power loss) or
  // already reset to 0 by Motor_TimerLoop / Motor_StateMachine
  // at the proper cycle-completion and mode-transition points.

  // Non-blocking transition
  lcdState = LCD_STATE_PENDING_START;
  displayForceInitFlag = 0;
}

void Motor_Stop(void) {
  RELAY = 0;
  motorState = 0;
  motorOffMillis = getMillis();
  // Fixed: Always trigger LCD refresh after relay stops to recover from noise
  lcdState = LCD_STATE_PENDING_STOP;
}

uint8_t Motor_ReadAutoStartSw(void) {
  // SW is PA10
  if (SW == 1) {
    autoStartFlag = 0;
    // printf("**********Autostart Button Not Pressed \r\n");
  } else {
    autoStartFlag = 1;
    // printf("**********Autostart Button Pressed \r\n");
  }
  return autoStartFlag;
}

int Motor_CheckImbalance(void) {
  float calculateVal = 0.0;
  uint8_t loadImbalanceFlag = 0;

  // check for RY Coil
  /* printf("Unbalance:");
  calculateVal = (fabs(Cur_R - Cur_Y) / Cur_R) * 100;
  printf("RY :%.2f ", calculateVal);
  if (calculateVal > GlobalSettings.Voltage_Imbalance)
    loadImbalanceFlag++;
  if (calculateVal > CABLE_OPEN_LOAD_IMBALANCE)
    cableopenFlag = 2;

  // check for YR Coil
  calculateVal = (fabs(Cur_Y - Cur_R) / Cur_Y) * 100;
  printf("YR :%.2f", calculateVal);
  if (calculateVal > GlobalSettings.Voltage_Imbalance)
    loadImbalanceFlag++;
  if (calculateVal > CABLE_OPEN_LOAD_IMBALANCE)
    cableopenFlag = 2;

  // check for YB Coil
  calculateVal = (fabs(Cur_Y - Cur_B) / Cur_Y) * 100;
  printf("YB :%.2f ", calculateVal);
  if (calculateVal > GlobalSettings.Voltage_Imbalance)
    loadImbalanceFlag++;
  if (calculateVal > CABLE_OPEN_LOAD_IMBALANCE)
    cableopenFlag = 2;

  // check for BY Coil
  calculateVal = (fabs(Cur_B - Cur_Y) / Cur_B) * 100;
  printf("BY :%.2f ", calculateVal);
  if (calculateVal > GlobalSettings.Voltage_Imbalance)
    loadImbalanceFlag++;
  if (calculateVal > CABLE_OPEN_LOAD_IMBALANCE)
    cableopenFlag = 2;

  // check for RB Coil
  calculateVal = (fabs(Cur_R - Cur_B) / Cur_R) * 100;
  printf("RB :%.2f ", calculateVal);
  if (calculateVal > GlobalSettings.Voltage_Imbalance)
    loadImbalanceFlag++;
  if (calculateVal > CABLE_OPEN_LOAD_IMBALANCE)
    cableopenFlag = 2;

  // check for BR Coil
  calculateVal = (fabs(Cur_B - Cur_R) / Cur_B) * 100;
  printf("BR :%0.2f \r\n", calculateVal);
  if (calculateVal > GlobalSettings.Voltage_Imbalance)
    loadImbalanceFlag++;
  if (calculateVal > CABLE_OPEN_LOAD_IMBALANCE)
    cableopenFlag = 2; */

  // check for RY Coil
  calculateVal = (fabs(Cur_R - Cur_Y) / Cur_R) * 100;
  if (calculateVal > GlobalSettings.Voltage_Imbalance)
    loadImbalanceFlag++;
  if (calculateVal > CABLE_OPEN_LOAD_IMBALANCE)
    cableopenFlag = 2;

  // check for YR Coil
  calculateVal = (fabs(Cur_Y - Cur_R) / Cur_Y) * 100;
  if (calculateVal > GlobalSettings.Voltage_Imbalance)
    loadImbalanceFlag++;
  if (calculateVal > CABLE_OPEN_LOAD_IMBALANCE)
    cableopenFlag = 2;

  // check for YB Coil
  calculateVal = (fabs(Cur_Y - Cur_B) / Cur_Y) * 100;
  if (calculateVal > GlobalSettings.Voltage_Imbalance)
    loadImbalanceFlag++;
  if (calculateVal > CABLE_OPEN_LOAD_IMBALANCE)
    cableopenFlag = 2;

  // check for BY Coil
  calculateVal = (fabs(Cur_B - Cur_Y) / Cur_B) * 100;
  if (calculateVal > GlobalSettings.Voltage_Imbalance)
    loadImbalanceFlag++;
  if (calculateVal > CABLE_OPEN_LOAD_IMBALANCE)
    cableopenFlag = 2;

  // check for RB Coil
  calculateVal = (fabs(Cur_R - Cur_B) / Cur_R) * 100;
  if (calculateVal > GlobalSettings.Voltage_Imbalance)
    loadImbalanceFlag++;
  if (calculateVal > CABLE_OPEN_LOAD_IMBALANCE)
    cableopenFlag = 2;

  // check for BR Coil
  calculateVal = (fabs(Cur_B - Cur_R) / Cur_B) * 100;
  if (calculateVal > GlobalSettings.Voltage_Imbalance)
    loadImbalanceFlag++;
  if (calculateVal > CABLE_OPEN_LOAD_IMBALANCE)
    cableopenFlag = 2;

  return loadImbalanceFlag;
}

void Motor_UpdateRunTime(void) {
  // uint16_t onCompleted,offCompleted; // Unused
  // onCompleted = offCompleted = 0;

  if (motorState) {
    lastMotorOnCycleMinutes = ((getMillis() - motorOnMillis) / 1000) / 60;
    if (lastMotorOnCycleMinutes == 0) {
      prevRunMinutes = 0;
    }


    if (lastMotorOnCycleMinutes > prevRunMinutes) {
      completedMinutesInCurrentCycle++;
      prevRunMinutes = lastMotorOnCycleMinutes;
      TotalRunTime[0]++;
      TotalRunTime[1] = completedMinutesInCurrentCycle;

      if (TotalRunTime[0] > 600000) { // Limit approx 10k hours
        TotalRunTime[0] = 0;
        TotalRunTime[1] = 0;
      }
      Write_RunTime_To_Flash(TotalRunTime);
      printf("####### RunTime Update (Normal): Total:%02u:%02u (HH:MM), "
             "Cycle:%u Min #######\r\n",
             TotalRunTime[0] / 60, TotalRunTime[0] % 60,
             completedMinutesInCurrentCycle);
    } else {
      /* printf("\r\n lastMotorOnCycleMinutes: %u \r\n",
    lastMotorOnCycleMinutes); */
    }
  }
}

void Motor_TimerLoop(void) {
  uint16_t onCompleted, offCompleted;
  onCompleted = offCompleted = 0;
  /* printf("\r\nTimerLoop: completedMinutesInCurrentCycle: %u \r\n",
         completedMinutesInCurrentCycle); */

  if (motorState) {
    lastMotorOnCycleMinutes = ((getMillis() - motorOnMillis) / 1000) / 60;
    if (lastMotorOnCycleMinutes == 0) {
      prevRunMinutes = 0;
    }
    /* printf("\r\n lastMotorOnCycleMinutes: %u, prevRunMinutes:%u \r\n",
           lastMotorOnCycleMinutes, prevRunMinutes); */
    if (lastMotorOnCycleMinutes > prevRunMinutes) {
      completedMinutesInCurrentCycle++;
      prevRunMinutes = lastMotorOnCycleMinutes;
      TotalRunTime[0]++;
      TotalRunTime[1] = completedMinutesInCurrentCycle;

      if (TotalRunTime[0] > 600000) {
        TotalRunTime[0] = 0;
        TotalRunTime[1] = 0;
      }
      Write_RunTime_To_Flash(TotalRunTime);
      printf("####### RunTime Update (Cyclic): Total:%02u:%02u (HH:MM), "
             "Cycle:%u Min #######\r\n",
             TotalRunTime[0] / 60, TotalRunTime[0] % 60,
             completedMinutesInCurrentCycle);
    } else {
      // Diagnostic Trace
      static uint32_t last_timer_diag = 0;
      if (getMillis() - last_timer_diag > 20000) {
        last_timer_diag = getMillis();
        printf(
            "[Timer Trace] State:%d, OnTime:%u sec, curMin:%u, prevMin:%u\r\n",
            state, (getMillis() - motorOnMillis) / 1000,
            lastMotorOnCycleMinutes, prevRunMinutes);
      }
    }
    onCompleted = ((getMillis() - motorOnMillis) / 1000) / 60;
    if (GlobalSettings.AutoRestart) {
      /* printf("\r\nOnTimeRemaining:%d", ((GlobalSettings.Timing_MotOnTime)
         - (completedMinutesInCurrentCycle))); */
      if ((completedMinutesInCurrentCycle) >=
          (GlobalSettings.Timing_MotOnTime)) {
        state = STATE_STOP;
        completedMinutesInCurrentCycle = 0;
        prevRunMinutes = 0;
        TotalRunTime[1] = 0;
        Write_RunTime_To_Flash(TotalRunTime);
        Motor_Stop();
      }
    } else {
      /* printf("\r\nOnTimeRemaining:%d",
             ((GlobalSettings.Timing_MotOnTime) - (onCompleted))); */
      if ((onCompleted) >= GlobalSettings.Timing_MotOnTime) {
        state = STATE_STOP;
        completedMinutesInCurrentCycle = 0;
        prevRunMinutes = 0;
        TotalRunTime[1] = 0;
        Write_RunTime_To_Flash(TotalRunTime);
        Motor_Stop();
      }
    }

  } else {
    if (GlobalSettings.Timing_MotRestartTime) {
      offCompleted = ((getMillis() - motorOffMillis) / 1000) / 60;
      /* printf("\r\nOffTimeRemaining:%d",
             ((GlobalSettings.Timing_MotRestartTime) - offCompleted)); */
      if (offCompleted >= GlobalSettings.Timing_MotRestartTime) {

        // bug detected 04-FEB-2026, here pump is switching on without
        // checking faults
        if (yPhaseLossFlag == 1) {
          activeFaultCode = FAULT_Y_PHASE;
          state = STATE_FAULT;
        } else if (overVoltageFlag == 1) {
          activeFaultCode = FAULT_OVER_VOLT;
          state = STATE_FAULT;
        } else {
          faultDetetctedAtIdleFlag = 0;
          state = STATE_RUNNING_FAULT_CHECK;
          Motor_Start();
        }

        // STATE_AUTOSTART
      }
    } else {
      // state = STATE_RESET;
      // printf("\r\n TimerLoop State Changed to Reset \r\n");
    }
  }
}

uint16_t Motor_GetOnTimerSinceLastStart(void) {
  if (motorState) {
    return (((getMillis() - motorOnMillis) / 1000) / 60);
  } else {
    return 0;
  }
}

uint16_t Motor_GetOnRemainingTime(void) {
  uint16_t onCompleted;
  if (motorState) {

    onCompleted = ((getMillis() - motorOnMillis) / 1000) / 60;

    if (GlobalSettings.AutoRestart) {
      printf("getMotorOnRemainingTime: %u \r\n",
             (GlobalSettings.Timing_MotOnTime) -
                 (completedMinutesInCurrentCycle));
      return ((GlobalSettings.Timing_MotOnTime) -
              (completedMinutesInCurrentCycle));
    } else {
      printf("getMotorOnRemainingTime: %u \r\n",
             (GlobalSettings.Timing_MotOnTime) - (onCompleted));
      return ((GlobalSettings.Timing_MotOnTime) - (onCompleted));
    }

  } else {
    printf("getMotorOnRemainingTime failure\r\n");
    return 0;
  }
}

uint16_t Motor_GetOffRemainingTime(void) {
  uint16_t offCompleted;
  if (motorState == 0 && GlobalSettings.Timing_MotRestartTime) {
    offCompleted = ((getMillis() - motorOffMillis) / 1000) / 60;
    return ((GlobalSettings.Timing_MotRestartTime) - offCompleted);
  } else {
    return 0;
  }
}

void Motor_DisplayWrongSequenceInfo(uint8_t errorType) {

  if (errorType == ERROR_PHASE_SEQ) {
    LCD_String(1, 0, "**LINE REVERSE**");
    LCD_String(2, 0, "Interchange R&B");
  } else if (errorType == ERROR_Y_PHASE) {
    LCD_Clear();
    LCD_String(1, 0, "3 PHASE ERROR");
    LCD_String(2, 0, "Check all 3 Ph");
  }
}

void Motor_StateMachine(void) {
  char str[20] = {0};
  uint16_t sw_val;
  uint32_t tempVal;
  uint8_t seqStatus = Measurement_CheckPhaseSequenceFlag();

  static uint8_t first_auto_check = 1;
  uint8_t manualToAutoTransition = 0;

  // Poll AutoStart switch status
  Motor_ReadAutoStartSw();

  // Capture initial state on first run to avoid fake transition at boot
  if (first_auto_check) {
    prevAutoStartFlag = autoStartFlag;
    first_auto_check = 0;
  }

  if (autoStartFlag == 1 && prevAutoStartFlag == 0) {
    manualToAutoTransition = 1;
  }

  // Global AutoStart Switch Transition Handler
  if (manualToAutoTransition) {
    completedMinutesInCurrentCycle = 0;
    prevRunMinutes = 0;
    TotalRunTime[1] = 0;
    Write_RunTime_To_Flash(TotalRunTime);
    // Reset all state flags to ensure a clean start in Auto mode
    autoStartBeginFlag = 0;
    dryRunCheckInitFlag = 0;
    overloadInitFlag = 0;
    imbalanceDetectFlag = 0;
    pumpOnFlag = 0;
    cableopenFlag = 0;
    faultInitFlag = 0;

    // If waiting in any state, trigger a fresh AutoStart countdown
    if (state == STATE_IDLE || state == STATE_STOP || state == STATE_RESET) {
      state = STATE_AUTOSTART;
    }
    printf("AutoStart Switch: Manual -> Auto (Global Reset). State:%d\r\n",
           state);
  }
  static int prevState = -1;
  static uint32_t stateEntryMillis = 0;

  if (state != prevState) {
    stateEntryMillis = getMillis();
    prevState = state;
  }

  // Poll AutoStart switch status
  Motor_ReadAutoStartSw();

  // Debug State Print (Throttled to 1s)
  static uint32_t last_state_print = 0;
  if (getMillis() - last_state_print >= 1000) {
    last_state_print = getMillis() - ((getMillis() - last_state_print) % 1000);
    const char *state_names[] = {
        "IDLE", "AUTOSTART", "RUNNING_CHECK", "FAULT",
        "STOP", "RESET",     "DRY_RUN_RESET", "POWER_ON_DELAY"};
    if (state >= 0 && state <= 7) {
      // Clear screen code (optional, can be \033[2J\033[H for ANSI terminals,
      // but might be messy if not supported) tailored for clean scrolling log
      printf("\r\n--- SYSTEM STATUS ---\r\n");
      printf("[State: %s] [Seq: %s] [Flags: PL=%d YPL=%d OV=%d PS=%d]\r\n",
             state_names[state], (phaseSequenceCorrectFlag > 0) ? "FWD" : "REV",
             phaseloss_flag, yPhaseLossFlag, overVoltageFlag, phase_seq_fault);
      printf("PHASE |  R: %5.1fV %4.1fA |  Y: %5.1fV %4.1fA |  B: %5.1fV "
             "%4.1fA\r\n",
             VR, Cur_R, VY, Cur_Y, VB, Cur_B);
      printf("LINE  | RY: %5.1fV      | YB: %5.1fV      | RB: %5.1fV\r\n", VRY,
             VYB, VRB);
      printf("ANGLE | RY: %5.1f       | YB: %5.1f       | RB: %5.1f\r\n",
             RyAngle, YbAngle, RbAngle);
      printf("---------------------\r\n");
    } else {
      printf("System State: UNKNOWN (%d)\r\n", state);
    }
  }

  // Handle Non-Blocking LCD Initialization
  if (lcdState == LCD_STATE_PENDING_START) {
    if (getMillis() - motorOnMillis >= 500) {
      LCD_Init();
      LCD_Clear();
      displayForceInitFlag = 1;
      lcdState = LCD_STATE_IDLE;
    }
  } else if (lcdState == LCD_STATE_PENDING_STOP) {
    if (getMillis() - motorOffMillis >= 500) {
      displayForceInitFlag = 0;
        LCD_Init();
        LCD_Clear();
      lcdState = LCD_STATE_IDLE;
    }
  }

  // Periodic LCD Refresh (Every 60 Seconds Backup)
  static uint32_t last_lcd_reinit_millis = 0;
  if (getMillis() - last_lcd_reinit_millis > 60000) {
    last_lcd_reinit_millis = getMillis();
    LCD_Init(); // This serves as a fail-safe against EMI noise
  }

  // --- POWER ON DELAY STATE ---
  if (state == STATE_POWER_ON_DELAY) {
    static uint32_t pod_start_millis = 0;
    static uint8_t pod_initialized = 0;
    static uint32_t led_toggle_millis = 0;
    static uint8_t led_state = 0;
    static uint8_t pod_phase = 0;
    static uint32_t countdown_last_update = 0;
    static int count_sec = 0;

    if (!pod_initialized) {
      pod_start_millis = getMillis();
      pod_initialized = 1;
      pod_phase = 0;
      count_sec = POD_VAL;
      // LEDs are now managed in Motor_VerifyPhases() for consistency
      LCD_Clear();
      LCD_String(1, 0, " *** AJANTA ***");
      LCD_String(2, 0, "-Control Panels-");
    }

    uint32_t elapsed = getMillis() - pod_start_millis;

    if (elapsed < POWER_ON_DELAY) {
      // Phase 1: Logo (Already shown)
    } else if (elapsed < (POWER_ON_DELAY + 2000)) {
      // Phase 2: Version Info
      if (pod_phase == 0) {
        pod_phase = 1;
        LCD_Clear();
        snprintf(str, sizeof(str), "Ver: %s", BUILD_VERSION);
        LCD_String(1, 0, str);
        snprintf(str, sizeof(str), "%s", __DATE__);
        LCD_String(2, 0, str);
      }
    } else if (elapsed < (POWER_ON_DELAY + 2000 + (POD_VAL * 1000))) {
      // Phase 3: Countdown
      if (pod_phase == 1) {
        pod_phase = 2; // Switch to phase 3
        LCD_Clear();
        LCD_String(1, 0, "*Power On Delay*");
        countdown_last_update = 0; // Force immediate update
      }

      if (getMillis() - countdown_last_update >= 1000) {
        countdown_last_update = getMillis();
        if (count_sec >= 0) {
          sprintf(str, "%d Secs ", count_sec--);
          LCD_String(2, 6, str);
        }
      }
    } else {
      // Done
      UI_BootPhaseCheck();

      // Immediate check for Phase Sequence Fault after POD
      if (phase_seq_fault) {
        Motor_DisplayWrongSequenceInfo(ERROR_PHASE_SEQ);
        Delay_ms(3000);
        state = STATE_IDLE;
        // Bypass the 1.5s "Init Fault" parameter display to show error
        // immediately
        faultInitFlag = 1;
        faultInitMillis = getMillis() - 1600;
      } else if (yPhaseLossFlag == 1) {
        Motor_DisplayWrongSequenceInfo(ERROR_Y_PHASE);
        Delay_ms(3000);
        state = STATE_IDLE;
        // Bypass the 1.5s "Init Fault" parameter display to show error
        // immediately
        faultInitFlag = 1;
        faultInitMillis = getMillis() - 1600;
      } else {
        state = STATE_IDLE;
      }

      // LCD_Clear();
      // LED_RED = LED_YEL = LED_BLU = 0; // Turn off LEDs (Active High: 0=OFF)
      pod_initialized = 0; // Reset for future use (if any)
    }
    return; // Return to allow other non-blocking tasks (like measurements) to
            // run
  }
  if (state == STATE_IDLE) {
    autoStartBeginFlag = dryRunCheckInitFlag = overloadInitFlag =
        imbalanceDetectFlag = pumpOnFlag = cableopenFlag = faultInitFlag = 0;
    activeFaultCode = FAULT_NONE;
    // printf("\r\nIdle");

    if ((autoStartFlag) && (yPhaseLossFlag == 0) && (overVoltageFlag == 0) &&
        (ph_RatioFlag == 0) && (phase_seq_fault == 0) && (seqStatus == 1)) {
      state = STATE_AUTOSTART;
    }
    if (yPhaseLossFlag == 1) {
      activeFaultCode = FAULT_Y_PHASE;
      state = STATE_FAULT;
      faultDetetctedAtIdleFlag = 1;
    } else if (overVoltageFlag == 1) {
      activeFaultCode = FAULT_OVER_VOLT;
      state = STATE_FAULT;
      faultDetetctedAtIdleFlag = 1;
    } else if (phase_seq_fault == 1) {
      activeFaultCode = FAULT_PHASE_SEQ;
      state = STATE_FAULT;
      faultDetetctedAtIdleFlag = 1;
    } else {
      faultDetetctedAtIdleFlag = 0;
    }
    UI_DisplayParameters(3);
    sw_val = UI_ReadButton();
    if ((sw_val == BUTTON_PREV) && (ph_RatioFlag == 0) && (seqStatus == 1)) {
      state = STATE_RUNNING_FAULT_CHECK;
      motorOnManualFlag = 1;
      pumpOnFlag = 0;
    } else if (sw_val == BUTTON_NEXT) {
      state = STATE_STOP;
      motorOffManualFlag = 1;
    } else {
      // Check for IoT remote motor ON request
      if (iot_motor_on_request && (ph_RatioFlag == 0) && (seqStatus == 1)) {
        iot_motor_on_request = 0;
        state = STATE_RUNNING_FAULT_CHECK;
        motorOnManualFlag = 1;
        pumpOnFlag = 0;
        printf("[IoT] Remote Motor ON accepted\r\n");
      } else if (iot_motor_on_request) {
        iot_motor_on_request = 0; // Clear even if rejected
        printf("[IoT] Remote Motor ON rejected (fault active)\r\n");
      }
      // saveButtonPressFlag is not strictly defined here as extern but
      // logical to just clear if defined? It was used in configuration(),
      // local to that file? Ah, saveButtonPressFlag is in Init_Settings.c
      // global. saveButtonPressFlag = 0; Need to decide where this button
      // logic lives.
    }
    // For now, removing undefined saveButtonPressFlag access unless added
    // to extern
  } else if (state == STATE_AUTOSTART) {
    // printf("\r\nAutostart");
    if (!autoStartBeginFlag) {
      autoStartBeginFlag = 1;
      autoStartMillis = getMillis();
      LCD_Clear();
    } else {
      // Display Auto Starting Message on screen
      uint32_t elapsed_s = (getMillis() - autoStartMillis) / 1000;
      if (elapsed_s < GlobalSettings.Timing_AutoStart) {
        tempVal = GlobalSettings.Timing_AutoStart - elapsed_s;
        static uint32_t last_autostart_display_update = 0;
        if (getMillis() - last_autostart_display_update > 500) {
          last_autostart_display_update = getMillis();
          // AutoStart Timing CountDown
          LCD_String(1, 5, "3 Phase    ");
          snprintf(str, sizeof(str), "%u Auto Starting   ", tempVal);
          LCD_String(2, 0, str);
        }
      } else {
        if (yPhaseLossFlag == 1) {
          activeFaultCode = FAULT_Y_PHASE;
          state = STATE_FAULT;
          faultDetetctedAtIdleFlag = 1;
        } else if (overVoltageFlag == 1) {
          activeFaultCode = FAULT_OVER_VOLT;
          state = STATE_FAULT;
          faultDetetctedAtIdleFlag = 1;
        } else if (phase_seq_fault == 1) {
          activeFaultCode = FAULT_PHASE_SEQ;
          state = STATE_FAULT;
          faultDetetctedAtIdleFlag = 1;
        } else {
          state = STATE_RUNNING_FAULT_CHECK;
          if (GlobalSettings.AutoRestart && GlobalSettings.CyclicTimer) {
            remainingOnTime = 0;
          }
        }
      }
      if (!autoStartFlag) {
        autoStartBeginFlag = 0;
        state = STATE_IDLE;
      }
    }
  } else if (state == STATE_RUNNING_FAULT_CHECK) {
    // printf("\r\nMotor Running");
    sw_val = UI_ReadButton();
    if (sw_val == BUTTON_NEXT) {
      state = STATE_STOP;
      prevAutoStartFlag = autoStartFlag;
      completedMinutesInCurrentCycle = 0;
      TotalRunTime[1] = 0;
      Write_RunTime_To_Flash(TotalRunTime);
      pumpOnFlag = 0;
    }
    // Check for IoT remote motor OFF request
    if (iot_motor_off_request) {
      iot_motor_off_request = 0;
      state = STATE_STOP;
      prevAutoStartFlag = autoStartFlag;
      completedMinutesInCurrentCycle = 0;
      TotalRunTime[1] = 0;
      Write_RunTime_To_Flash(TotalRunTime);
      pumpOnFlag = 0;
      printf("[IoT] Remote Motor OFF accepted\r\n");
    }
    if (!pumpOnFlag) {
      if (!overVoltageFlag && !phase_seq_fault && (yPhaseLossFlag == 0)) {
        Motor_Start();
        pumpOnFlag = 1;
        // printf("\r\nMotor On");

      } else {
        state = STATE_FAULT;
      }
    } else {
      // Continuous fault monitoring while running (Check all Phase Losses)
      if (overVoltageFlag || phase_seq_fault || (yPhaseLossFlag == 1) ||
          (phaseloss_flag != 0)) {
        Motor_Stop();
        if (yPhaseLossFlag)
          activeFaultCode = FAULT_Y_PHASE;
        else if (phaseloss_flag)
          activeFaultCode = FAULT_PHASE_LOSS;
        else if (overVoltageFlag)
          activeFaultCode = FAULT_OVER_VOLT;
        else if (phase_seq_fault)
          activeFaultCode = FAULT_PHASE_SEQ;

        state = STATE_FAULT;
        pumpOnFlag = 0;
        voltage_fault = 1;
        return; // Early exit to prevent other checks (like cable open) from
      }
    }
    UI_DisplayParameters(3);

    // Check For cable fault (Only if no voltage fault is active)
    static uint32_t cableFaultDebounce = 0;
    if (((getMillis() - motorOnMillis) > 6000) && !overVoltageFlag &&
        !phase_seq_fault && (yPhaseLossFlag == 0) && (phaseloss_flag == 0)) {
      // Cable open check
      if ((Cur_R) < 1.3 || (Cur_Y) < 1.3 || (Cur_B) < 1.3) {
        if (cableFaultDebounce == 0)
          cableFaultDebounce = getMillis();
        if ((getMillis() - cableFaultDebounce) > 4000) {
          // Confirmed Fault after 2 seconds
          if ((Cur_R) < 1.3 && (Cur_Y) < 1.3 && (Cur_B) < 1.3) {
            cableopenFlag = 1;
            activeFaultCode = FAULT_CABLE_OPEN_ALL;
            printf("\r\n Cable Open Fault All \r\n");
            Motor_Stop();
            state = STATE_FAULT;
            cableFaultDebounce = 0;
          } else {
            cableopenFlag = 2;
            activeFaultCode = FAULT_CABLE_OPEN_PARTIAL;
            Motor_Stop();
            state = STATE_FAULT;
            printf("\r\n Cable Open Fault 2 \r\n");
            cableFaultDebounce = 0;
          }
        }
      } else {
        cableFaultDebounce = 0;
      }

      if (((Cur_R < GlobalSettings.Current_DryRun) && (Cur_R > 1.3)) &&
          ((Cur_Y < GlobalSettings.Current_DryRun) && (Cur_Y > 1.3)) &&
          ((Cur_B < GlobalSettings.Current_DryRun) && (Cur_B > 1.3))) {
        // Initialize Dry Continuous dry run check for Dry Run Check
        if (!dryRunCheckInitFlag) {
          dryRunCheckInitFlag = 1;
          dryRunCheckMillis = getMillis();
        }
        if (dryRunCheckInitFlag) {
          if (((GlobalSettings.Timing_DryRun -
                ((getMillis() - dryRunCheckMillis) / 1000)) > 0) &&
              (((GlobalSettings.Timing_DryRun -
                 ((getMillis() - dryRunCheckMillis) / 1000)) < 30))) {
            if (((Cur_R < GlobalSettings.Current_DryRun) && (Cur_R > 1.3)) &&
                ((Cur_Y < GlobalSettings.Current_DryRun) && (Cur_Y > 1.3)) &&
                ((Cur_B < GlobalSettings.Current_DryRun) && (Cur_B > 1.3))) {
              /* printf("\r\nDry Run Time: %u",
                 (GlobalSettings.Timing_DryRun -
                  ((getMillis() - dryRunCheckMillis) / 1000))); */
            } else {
              dryRunCheckInitFlag = 0;
            }
          } else {
            // Dry Run TimeOut. perform Dry run reset
            Motor_Stop();
            activeFaultCode = FAULT_DRY_RUN;
            state = STATE_FAULT;
            printf("\r\n Dry Run Fault \r\n");
          }
        }
      }
      if ((Cur_R) > GlobalSettings.Current_OverLoad ||
          (Cur_Y) > GlobalSettings.Current_OverLoad ||
          (Cur_B) > GlobalSettings.Current_OverLoad) {
        // Initialize Continous overload condition
        if (!overloadInitFlag) {
          overloadInitFlag = 1;
          overloadInitMillis = getMillis();
        }
        if (overloadInitFlag) {
          if ((OVERLOAD_TIMEOUT - ((getMillis() - overloadInitMillis) / 1000) >
               0)) {
            if ((Cur_R) > GlobalSettings.Current_OverLoad ||
                (Cur_Y) > GlobalSettings.Current_OverLoad ||
                (Cur_B) > GlobalSettings.Current_OverLoad) {
              /* printf("\r\nOverload Time: %u",
                 (OVERLOAD_TIMEOUT -
                  ((getMillis() - overloadInitMillis) / 1000))); */
            } else {
              overloadInitFlag = 0;
            }
          } else {
            // Overload TimeOut.
            Motor_Stop();
            activeFaultCode = FAULT_OVER_LOAD;
            state = STATE_FAULT;
            printf("\r\n Over Load Fault \r\n");
          }
        }
      }
      int imbalance = Motor_CheckImbalance();
      if (imbalance) {
        if (!imbalanceDetectFlag) {
          imbalanceDetectFlag = 1;
          imbalanceDetectMillis = getMillis();
        }
        if (imbalanceDetectFlag) {
          if ((IMBALANCE_TIMEOUT -
                   ((getMillis() - imbalanceDetectMillis) / 1000) >
               0)) {
            if (imbalance) // Check Load Imbalance
            {
              /* printf("\r\n Imbalance Time: %u",
                   (IMBALANCE_TIMEOUT -
                    ((getMillis() - imbalanceDetectMillis) / 1000))); */
            } else {
              imbalanceDetectFlag = 0;
            }
          } else {
            // Overload TimeOut.
            Motor_Stop();
            activeFaultCode = FAULT_IMBALANCE;
            state = STATE_FAULT;
            printf("\r\n Load Imbalance Fault \r\n");
          }
        }
      }
    }
    if (GlobalSettings.CyclicTimer && autoStartFlag) {
      Motor_TimerLoop();
    } else {
      Motor_UpdateRunTime();
    }
  } else if (state == STATE_FAULT) {
    // printf("\r\nFault");
    if (!faultInitFlag) {
      Motor_Stop();
      faultInitFlag = 1;
      faultInitMillis = getMillis();
      Measurement_ReadVoltage();
      // Notify IoT server immediately
      IoT_SendFault(activeFaultCode);
      // Removed blocking loop
    }

    // --- FAULT PROMOTION LOGIC ---
    // If we are currently in a current fault (manual reset), but a voltage
    // fault is now active (e.g. phase dropped further), upgrade it to a voltage
    // fault (auto reset). Root cause is usually the voltage.
    if (!voltage_fault || activeFaultCode == FAULT_DRY_RUN ||
        activeFaultCode == FAULT_CABLE_OPEN_ALL ||
        activeFaultCode == FAULT_CABLE_OPEN_PARTIAL ||
        activeFaultCode == FAULT_OVER_LOAD ||
        activeFaultCode == FAULT_IMBALANCE) {
      if (yPhaseLossFlag) {
        activeFaultCode = FAULT_Y_PHASE;
        voltage_fault = 1;
        current_fault = 0;
      } else if (phaseloss_flag != 0) {
        activeFaultCode = FAULT_PHASE_LOSS;
        voltage_fault = 1;
        current_fault = 0;
      } else if (overVoltageFlag) {
        activeFaultCode = FAULT_OVER_VOLT;
        voltage_fault = 1;
        current_fault = 0;
      } else if (phase_seq_fault) {
        activeFaultCode = FAULT_PHASE_SEQ;
        voltage_fault = 1;
        current_fault = 0;
      }
    }

    uint32_t faultElapsed = getMillis() - faultInitMillis;

    // Phase 1: Initial Parameter Display (0 - 1.5s)
    if (faultElapsed < 1500) {
      if (activeFaultCode == FAULT_PHASE_SEQ) {
        Motor_DisplayWrongSequenceInfo(ERROR_PHASE_SEQ);
        voltage_fault = 1;
      } else {
        static uint32_t last_p1_refresh = 0;
        if (getMillis() - last_p1_refresh > 500) {
          last_p1_refresh = getMillis();
          UI_DisplayParameters(1);
        }
      }
    }
    // Phase 2: Fault Identification Display (1.5s - 8s)
    else if (faultElapsed < 8000) {
      static uint32_t last_fault_display_update = 0;
      if (getMillis() - last_fault_display_update > 500) {
        last_fault_display_update = getMillis();

        // Refresh Line 1 periodically so it doesn't stay empty
        UI_DisplayParameters(1);

        const char *prefix = faultDetetctedAtIdleFlag ? "Err:" : "TRIP:";

        switch (activeFaultCode) {
        case FAULT_Y_PHASE:
        case FAULT_PHASE_LOSS:
          LCD_String(2, 0,
                     (char *)(faultDetetctedAtIdleFlag ? "Err:Phase Fail "
                                                       : "TRIP:Phase Fail "));
          voltage_fault = 1;
          break;
        case FAULT_OVER_VOLT:
          LCD_String(2, 0,
                     (char *)(faultDetetctedAtIdleFlag ? "Err:Over Volt  "
                                                       : "TRIP:Over Volt  "));
          voltage_fault = 1;
          break;
        case FAULT_PHASE_SEQ:
          Motor_DisplayWrongSequenceInfo(ERROR_PHASE_SEQ);
          voltage_fault = 1;
          break;
        case FAULT_DRY_RUN:
          LCD_String(2, 0, "TRIP: Dry Run  ");
          current_fault = 1;
          break;
        case FAULT_CABLE_OPEN_ALL:
          LCD_String(2, 0, "TRIP: Cable Open");
          current_fault = 1;
          break;
        case FAULT_CABLE_OPEN_PARTIAL:
          LCD_String(1, 0, "TRIP:Cable Open or");
          LCD_String(2, 0, "(OR) Motor Fault");
          current_fault = 1;
          break;
        case FAULT_OVER_LOAD:
          LCD_String(2, 0, "TRIP: Over Load ");
          current_fault = 1;
          break;
        case FAULT_IMBALANCE:
          LCD_String(2, 0, "TRIP:Motor Fault ");
          current_fault = 1;
          break;
        }
      }
    }
    // Phase 3: Recovery Logic (> 8s)
    else {
      if (voltage_fault) {
        // Toggle between voltage error message and parameters
        if (voltageErrorFlag) {
          switch (activeFaultCode) {
          case FAULT_Y_PHASE:
          case FAULT_PHASE_LOSS:
            LCD_String(2, 0,
                       (char *)(faultDetetctedAtIdleFlag ? "Err:Phase Fail "
                                                         : "TRIP:Phase Fail "));
            break;
          case FAULT_OVER_VOLT:
            LCD_String(2, 0,
                       (char *)(faultDetetctedAtIdleFlag ? "Err:Over Volt  "
                                                         : "TRIP:Over Volt  "));
            break;
          case FAULT_PHASE_SEQ:
            Motor_DisplayWrongSequenceInfo(ERROR_PHASE_SEQ);
            break;
          }
        } else {
          UI_DisplayParameters(3);
        }

        if (getMillis() - voltageErrorDisplayMillis > 4000) {
          voltageErrorFlag = !voltageErrorFlag;
          voltageErrorDisplayMillis = getMillis();
        }

        // AUTO-RECOVERY for Voltage Faults
        if (yPhaseLossFlag == 0 && overVoltageFlag == 0 &&
            phase_seq_fault == 0 && phaseloss_flag == 0) {
          voltage_fault = 0;
          prevRunMinutesFlag = 1;
          state = STATE_IDLE;
        }
      } else if (activeFaultCode == FAULT_DRY_RUN) {
        state = STATE_DRY_RUN_RESET;
      } else if (current_fault) {
        // Manual Reset for other current faults
        static uint32_t last_cf_display_update = 0;
        if (getMillis() - last_cf_display_update > 500) {
          last_cf_display_update = getMillis();
          // Refresh Line 1
          UI_DisplayParameters(1);
          // Redraw latched fault message
          switch (activeFaultCode) {
          case FAULT_CABLE_OPEN_ALL:
            LCD_String(2, 0, "TRIP: Cable Open");
            break;
          case FAULT_CABLE_OPEN_PARTIAL:
            LCD_String(1, 0, "TRIP:Cable Open or");
            LCD_String(2, 0, "(OR) Motor Fault");
            break;
          case FAULT_OVER_LOAD:
            LCD_String(2, 0, "TRIP: Over Load ");
            break;
          case FAULT_IMBALANCE:
            LCD_String(2, 0, "TRIP:Motor Fault ");
            break;
          }
        }

        sw_val = UI_ReadButton();
        if (sw_val == BUTTON_PREV || sw_val == BUTTON_NEXT) {
          current_fault = 0;
          imbalanceDetectFlag = 0;
          overloadInitFlag = 0;
          dryRunCheckInitFlag = 0;
          cableopenFlag = 0;
          state = STATE_IDLE;
          motorOnManualFlag = 1;
        }
      }
    }
  } else if (state == STATE_STOP) {
    // printf("\r\nStop");
    Motor_Stop();
    UI_DisplayParameters(3);
    if (GlobalSettings.CyclicTimer && autoStartFlag) {
      state = STATE_RESET;
    } else {
      if (autoStartFlag != prevAutoStartFlag) {
        state = STATE_IDLE;
      } else {
        if ((getMillis() - stateEntryMillis) > 2000) {
          sw_val = UI_ReadButton();
          if (sw_val == BUTTON_PREV) {
            state = STATE_IDLE;
            motorOnManualFlag = 1;
          }
        }
      }
    }
  } else if (state == STATE_RESET) {
    // printf("\r\nResetState");
    if (GlobalSettings.CyclicTimer && autoStartFlag) {
      Motor_TimerLoop();
      UI_DisplayParameters(3);
    } else if ((GlobalSettings.CyclicTimer &&
                (autoStartFlag =
                     0))) // WARNING: Assignment in if! Copying from
                          // original. Original was autoStartFlag=0 ??
    {
      // Original: else if((GlobalSettings.CyclicTimer &&
      // (autoStartFlag=0))) This is definitely an assignment in the
      // original code, effectively forcing autoStartFlag to 0 and failing
      // the check. Leaving it as-is for strict refactoring, but adding a
      // comment.
      Motor_TimerLoop();
      UI_DisplayParameters(3);
    } else {
      state = STATE_IDLE;
    }
    sw_val = UI_ReadButton();
    if (sw_val == BUTTON_PREV) {
      state = STATE_IDLE;
      motorOnManualFlag = 1;
    } else if (sw_val == BUTTON_NEXT) {
      state = STATE_STOP;
      motorOffManualFlag = 1;
    }
  } else if (state == STATE_DRY_RUN_RESET) {
    if (dryRunResetInitFlag == 0) {
      dryRunResetInitFlag = 1;
      dryrunResetMillis = getMillis();
      prevAutoStartFlag = autoStartFlag;
    } else {
      if (GlobalSettings.Timing_DryRunReset == 0) {
        // Wait for manual reset if time is 0
        LCD_String(2, 0, "TRIP:Dry Run    ");
      } else if ((((getMillis() - dryrunResetMillis) / 1000) / 60) <
                 GlobalSettings.Timing_DryRunReset) {
        dryRunResetMins = GlobalSettings.Timing_DryRunReset -
                          (((getMillis() - dryrunResetMillis) / 1000) / 60);
        snprintf(str, sizeof(str), "TRIP:UL RS:%02uM   ", dryRunResetMins);
        LCD_String(2, 0, str);
      } else {
        printf("Dry Run Reset Over. Manual Mode:%d \r\n", motorOnManualFlag);
        dryRunResetInitFlag = 0;
        dryRunCheckInitFlag = 0; // Clear dry run fault flag
        if (motorOnManualFlag) {
          state = STATE_RUNNING_FAULT_CHECK;
          pumpOnFlag = 0; // Trigger Motor_Start in running check state
        } else {
          state = STATE_IDLE;
        }
      }
      UI_DisplayParameters(1);
      sw_val = UI_ReadButton();
      if (sw_val == BUTTON_PREV) { // ON Button
        printf("Manual Reset (ON Pressed) \r\n");
        state = STATE_RUNNING_FAULT_CHECK;
        motorOnManualFlag = 1;
        pumpOnFlag = 0;
        dryRunResetInitFlag = 0;
        dryRunCheckInitFlag = 0;
      } else if (sw_val == BUTTON_NEXT) { // OFF Button
        printf("Manual Reset (OFF Pressed) \r\n");
        state = STATE_IDLE;
        motorOffManualFlag = 1;
        motorOnManualFlag = 0;
        dryRunResetInitFlag = 0;
        dryRunCheckInitFlag = 0;
      }

      if (autoStartFlag != prevAutoStartFlag) {
        printf("AutoStart Switch Change. Returning to IDLE \r\n");
        state = STATE_IDLE;
        dryRunResetInitFlag = 0;
        dryRunCheckInitFlag = 0;
      }
    }

  } else {
    state = STATE_IDLE;
  }

  // Update transition tracker at the end of every state machine cycle
  prevAutoStartFlag = autoStartFlag;
}
