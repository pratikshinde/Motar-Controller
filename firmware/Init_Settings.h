#ifndef __INIT_SETTINGS__
#define __INIT_SETTINGS__
#include "NuMicro.h"

// Define GlobalSettings structure (Shared across modules)
typedef struct {
  uint16_t state;            // Integrity Check / Initial State
  uint16_t Current_Load;     // in Amps 0 to 999
  uint16_t Current_OverLoad; // in Amps 0 to 999
  uint16_t Current_DryRun;   // in Amps 0 to 999
  uint16_t HP_Settings;      // in HP 0 to 100

  uint16_t Voltage_Under;              // 180 to 450
  uint16_t Voltage_Over;               // 180 to 450
  uint16_t Voltage_Imbalance;          // % 0 to 100
  uint16_t Voltage_PhaseSequenceCheck; // Enable or Disable
  uint16_t AutoRestart;                // Enable or Disable
  uint16_t CyclicTimer;                // Enable or Disable
  uint16_t CTRatio;                    // in ma/100A ratio
  uint16_t PHRatio;                    // in percentage

  uint16_t Timing_DryRun;         // in seconds
  uint16_t Timing_OverLoad;       // in seconds
  uint16_t Timing_MotOnTime;      // in minutes
  uint16_t Timing_MotRestartTime; // in minutes
  uint16_t Timing_DryRunReset;    // in minutes
  uint16_t Timing_AutoStart;      // in seconds
  uint16_t Timing_StarDeltaDelay; // in seconds

  float CalibMult_Voltage_R;
  float CalibMult_Voltage_Y;
  float CalibMult_Voltage_B;
  float CalibMult_Current_R;
  float CalibMult_Current_Y;
  float CalibMult_Current_B;

  uint16_t state2;
} GlobalSettings_t;

// System Init Functions
void SYS_Init(void);
void UART0_Init(void);
void InitGPIO(void);
void Init_Timer1_100ms(void);
void Timer1_Enable(void);
void Timer1_Disable(void);

// Settings Management
void readSettingsEEPROM(void);
void writeSettingEEPROM(void);

#endif // __INIT_SETTINGS__
