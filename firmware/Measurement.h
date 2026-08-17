#ifndef __MEASUREMENT_H__
#define __MEASUREMENT_H__

#include "Init_Settings.h" // For GlobalSettings_t and constants
#include "NuMicro.h"
#include "config.h"

// Constants
#define V_REF 3.3f            // MCU reference voltage
#define V_CENTER 1.65f        // DC bias voltage
#define DIVIDER_RATIO 154.36f // 230V RMS -> 1.49V peak
#define ADC_VOLT_RATIO 0.000805664f
#define SAMPLE_DELAY_US 69 // 20ms/256 -> ~78us per sample

#define ZCD_THRESHOLD 2048

// External variables (defined in Measurement.c)
extern int16_t RAW[ADC_SAMPLES];
extern volatile uint32_t r_zcd_count;
extern volatile uint8_t yPhaseError;
extern volatile uint32_t g_u32AdcIntFlag;

extern float VR, VY, VB;
extern float VRY, VYB, VRB;
extern float Cur_R, Cur_Y, Cur_B;
extern float vac_val_R, vac_val_Y, vac_val_B;
extern int R_max, R_min, Y_max, Y_min, B_max, B_min;
extern int R_Offset, Y_Offset, B_Offset;
extern int phaseSequenceCorrectFlag;
extern uint8_t ph_RatioFlag, phaseloss_flag; // 0=None, 1=R, 2=Y, 3=B
extern volatile uint8_t yPhaseLossFlag;
extern uint8_t overVoltageFlag, yPhaseTimerInitFlag;
extern uint8_t phaseNuetralConnectedFlag;
extern volatile uint8_t measurement_active;
extern int phaseSequenceCheckCount;
extern float RyAngle, YbAngle, RbAngle;

// Function Prototypes
void Measurement_Init(void);
void ADC_IRQHandler(void);
void Measurement_ReadVoltage(void);
void Measurement_ReadCurrent(void);
void Measurement_CollectSamples(uint8_t phase);
void Measurement_CalcPhaseSequence(void);
float Measurement_CalculatePhaseDiff(uint32_t time1, uint32_t time2);
uint8_t Measurement_CheckPhaseSequenceFlag(void);

#endif // __MEASUREMENT_H__
