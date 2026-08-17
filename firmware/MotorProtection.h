#ifndef __MOTOR_PROTECTION_H__
#define __MOTOR_PROTECTION_H__

#include "Init_Settings.h" // For GlobalSettings_t
#include "NuMicro.h"
#include "config.h"

// State Definitions
#define STATE_IDLE 0
#define STATE_AUTOSTART 1
#define STATE_RUNNING_FAULT_CHECK 2
#define STATE_FAULT 3
#define STATE_STOP 4
#define STATE_RESET 5
#define STATE_DRY_RUN_RESET 6
#define STATE_POWER_ON_DELAY 7

// Error Codes (for sequence functions)
#define ERROR_PHASE_SEQ 1
#define ERROR_Y_PHASE 2

// Fault Codes (Latched for STATE_FAULT display)
#define FAULT_NONE 0
#define FAULT_Y_PHASE 1
#define FAULT_PHASE_LOSS 2
#define FAULT_OVER_VOLT 3
#define FAULT_PHASE_SEQ 4
#define FAULT_DRY_RUN 5
#define FAULT_CABLE_OPEN_ALL 6
#define FAULT_CABLE_OPEN_PARTIAL 7
#define FAULT_OVER_LOAD 8
#define FAULT_IMBALANCE 9

// External Variables (defined in MotorProtection.c)
extern int state;
extern uint8_t activeFaultCode;
extern uint32_t motorState;
extern uint8_t autoStartFlag;
extern uint8_t pumpOnFlag;
extern uint8_t motorOnManualFlag;
extern uint8_t motorOffManualFlag;
extern uint8_t faultDetetctedAtIdleFlag;
extern uint8_t voltage_fault;
extern uint8_t current_fault;
extern uint8_t phase_seq_fault;
extern uint8_t cableopenFlag;
extern uint8_t dryRunCheckInitFlag;
extern uint8_t overloadInitFlag;
extern uint8_t imbalanceDetectFlag;
extern int16_t dryRunResetMins;
extern uint16_t completedMinutesInCurrentCycle;
extern uint32_t TotalRunTime[2];
extern uint32_t prevRunMinutes;
extern uint32_t lastMotorOnCycleMinutes;

extern uint32_t motorOnMillis;
extern uint32_t motorOffMillis;
extern uint32_t autoStartMillis;
extern uint32_t dryRunCheckMillis;
extern uint32_t overloadInitMillis;
extern uint32_t imbalanceDetectMillis;
extern uint32_t faultInitMillis;
extern uint32_t dryrunResetMillis;
extern uint32_t voltageErrorDisplayMillis;

extern uint8_t prevAutoStartFlag;
extern uint8_t autoStartBeginFlag;
extern uint8_t faultInitFlag;
extern uint8_t dryRunResetInitFlag;
extern uint8_t displayForceInitFlag;
extern uint8_t prevRunMinutesFlag;
extern uint8_t voltageErrorFlag;

// Function Prototypes
void Motor_VerifyPhases(void);
void Motor_StateMachine(void);
void Motor_Start(void);
void Motor_Stop(void);
int Motor_CheckImbalance(void);
uint8_t Motor_ReadAutoStartSw(void);
void Motor_TimerLoop(void);
uint16_t Motor_GetOffRemainingTime(void);
uint16_t Motor_GetOnRemainingTime(void);
uint16_t Motor_GetOnTimerSinceLastStart(void);
void Motor_UpdateRunTime(void);
void Motor_DisplayWrongSequenceInfo(uint8_t errorType);

#endif // __MOTOR_PROTECTION_H__
