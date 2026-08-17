#include "Measurement.h"
#include "MotorProtection.h"
#include "Timer3_Int.h" // For getMillis and Delay
#include "config.h"
#include <math.h>
#include <stdio.h>

// Global Variables Definition
int16_t RAW[ADC_SAMPLES];
volatile uint32_t r_zcd_count;
volatile uint8_t yPhaseError = 0;
uint8_t yPhaseTimerInitFlag = 0;
volatile uint32_t g_u32AdcIntFlag = 0;

float VR = 0.0f, VY = 0.0f, VB = 0.0f;
float VRY = 0.0f, VYB = 0.0f, VRB = 0.0f;
float Cur_R = 0.0f, Cur_Y = 0.0f, Cur_B = 0.0f;
float vac_val_R = 0.0f, vac_val_Y = 0.0f, vac_val_B = 0.0f;

int R_max, R_min, Y_max, Y_min, B_max, B_min;
int R_Offset, Y_Offset, B_Offset;
int phaseSequenceCorrectFlag = 0;
int phaseSequenceReverseFlag = 0;
uint8_t ph_RatioFlag = 0;
uint8_t phaseloss_flag = 0;
volatile uint8_t yPhaseLossFlag = 0;
uint8_t overVoltageFlag = 0;
uint8_t phaseNuetralConnectedFlag = 0;
volatile uint8_t measurement_active = 0;
int phaseSequenceCheckCount = 0;
float RyAngle = 120.0f, YbAngle = 120.0f, RbAngle = 240.0f;

// External dependencies
extern GlobalSettings_t GlobalSettings;
extern void Timer1_Enable(void);
extern void Timer1_Disable(void);

// LED Definitions (Need to ensure these act on pins defined in config.h or via
// macros) Ideally config.h defines LED_RED, LED_YEL, LED_BLU macros that access
// GPIO For now assuming direct access or macros exist as in Init_Settings.c

void ADC_IRQHandler(void) {
  g_u32AdcIntFlag = 1;
  ADC->ADSR0 = ADC_ADF_INT; /* Clear the A/D interrupt flag */
}

void Measurement_Init(void) {
  /* Enable ADC converter */
  ADC->ADCR |= ADC_ADCR_ADEN_Msk;

  /* Do calibration for ADC to decrease the effect of electrical random noise.
   */
  ADC->ADCALSTSR |=
      ADC_ADCALSTSR_CALIF_Msk; /* Clear Calibration Finish Interrupt Flag */
  ADC->ADCALR |= ADC_ADCALR_CALEN_Msk; /* Enable Calibration function */
  ADC_START_CONV(ADC);                 /* Start to calibration */
  while ((ADC->ADCALSTSR & ADC_ADCALSTSR_CALIF_Msk) != ADC_ADCALSTSR_CALIF_Msk)
    ; /* Wait calibration finish */

  // Configure ADC for single-cycle scan mode
  ADC->ADCR = (ADC->ADCR & ~(ADC_ADCR_DIFFEN_Msk | ADC_ADCR_ADMD_Msk)) |
              ADC_ADCR_ADMD_SINGLE_CYCLE;

  // Channels are enabled in specific functions
}

void Measurement_CollectSamples(uint8_t phase) {
  uint16_t i;
  // uint32_t prev_millis = getMillis(); // Unused
  if (phase < 3) {
    ADC->ADCHER = (ADC->ADCHER & (~ADC_ADCHER_CHEN_Msk)) | (BIT0 | BIT1 | BIT2);
  } else if (phase >= 3) {
    ADC->ADCHER = (ADC->ADCHER & (~ADC_ADCHER_CHEN_Msk)) | (BIT3 | BIT4 | BIT5);
  }

  for (i = 0; i < ADC_SAMPLES; i++) {
    // Start conversion
    ADC->ADCR |= ADC_ADCR_ADST_Msk;

    // Wait for completion
    while (!(ADC->ADSR0 & ADC_ADSR0_ADF_Msk))
      ;
    ADC->ADSR0 = ADC_ADSR0_ADF_Msk;
    RAW[i] = ADC->ADDR[phase];

    // Precision delay (approx 156us total with overhead for 128 samples =
    // ~20ms)
    CLK_SysTickDelay(156);
  }
}

void Measurement_ReadCurrent(void) {
  uint16_t i;
  // uint32_t prev_millis = getMillis(); // Unused
  Cur_R = Cur_Y = Cur_B = 0.0;

  Measurement_CollectSamples(C_R_PHASE);
  for (i = 0; i < ADC_SAMPLES; i++) {
    RAW[i] = RAW[i] - VOLTAGE_OFFSET_VAL;
    // VRMS Calculation for R
    vac_val_R =
        RAW[i] *
        (CURRENT_CALIBRATION_MULTIPLIER * GlobalSettings.CalibMult_Current_R *
         (GlobalSettings.CTRatio > 0 ? (float)GlobalSettings.CTRatio / 100.0f
                                     : 1.0f));
    Cur_R = Cur_R + (vac_val_R * vac_val_R);
  }
  Cur_R = sqrt(Cur_R / ADC_SAMPLES);

  Measurement_CollectSamples(C_Y_PHASE);
  for (i = 0; i < ADC_SAMPLES; i++) {
    RAW[i] = RAW[i] - VOLTAGE_OFFSET_VAL;
    // VRMS Calculation for Y
    vac_val_Y =
        RAW[i] *
        (CURRENT_CALIBRATION_MULTIPLIER * GlobalSettings.CalibMult_Current_Y *
         (GlobalSettings.CTRatio > 0 ? (float)GlobalSettings.CTRatio / 100.0f
                                     : 1.0f));
    Cur_Y = Cur_Y + (vac_val_Y * vac_val_Y);
  }
  Cur_Y = sqrt(Cur_Y / ADC_SAMPLES);

  Measurement_CollectSamples(C_B_PHASE);
  for (i = 0; i < ADC_SAMPLES; i++) {
    RAW[i] = RAW[i] - VOLTAGE_OFFSET_VAL;
    // VRMS Calculation for B
    vac_val_B =
        RAW[i] *
        (CURRENT_CALIBRATION_MULTIPLIER * GlobalSettings.CalibMult_Current_B *
         (GlobalSettings.CTRatio > 0 ? (float)GlobalSettings.CTRatio / 100.0f
                                     : 1.0f));
    Cur_B = Cur_B + (vac_val_B * vac_val_B);
  }
  Cur_B = sqrt(Cur_B / ADC_SAMPLES);

  // printf("Current R:%0.2f Y:%0.2f B:%0.2f\n", Cur_R, Cur_Y, Cur_B);
}

// Moving Average Buffer
#define VOLT_MA_SIZE 16
float ma_buffer_R[VOLT_MA_SIZE];
float ma_buffer_Y[VOLT_MA_SIZE];
float ma_buffer_B[VOLT_MA_SIZE];
uint8_t ma_index = 0;
float ma_sum_R = 0;
float ma_sum_Y = 0;
float ma_sum_B = 0;
uint8_t ma_initialized = 0;

void Measurement_ReadVoltage(void) {
  uint16_t i;
  VR = VY = VB = 0.0f;
  /***************** R Phase Voltage caluclations Begins Here *************/
  R_max = 0;
  R_min = 4096;
  Measurement_CollectSamples(V_R_PHASE);
  for (i = 0; i < ADC_SAMPLES; i++) {
    if (RAW[i] > R_max)
      R_max = RAW[i];
    if (RAW[i] < R_min)
      R_min = RAW[i];
  }
  R_Offset = R_max - ((R_max - R_min) / 2);

  for (i = 0; i < ADC_SAMPLES; i++) {
    RAW[i] = RAW[i] - R_Offset;
    vac_val_R = RAW[i] * ADC_VOLT_RATIO;
    VR = VR + (vac_val_R * vac_val_R);
  }
  VR = sqrt(VR / ADC_SAMPLES);

  /***************** Y Phase Voltage caluclations Begins Here *************/
  Y_max = 0;
  Y_min = 4096;
  Measurement_CollectSamples(V_Y_PHASE);
  for (i = 0; i < ADC_SAMPLES; i++) {
    if (RAW[i] > Y_max)
      Y_max = RAW[i];
    if (RAW[i] < Y_min)
      Y_min = RAW[i];
  }
  Y_Offset = Y_max - ((Y_max - Y_min) / 2);
  for (i = 0; i < ADC_SAMPLES; i++) {
    RAW[i] = RAW[i] - Y_Offset;
    vac_val_Y = RAW[i] * ADC_VOLT_RATIO;
    VY = VY + (vac_val_Y * vac_val_Y);
  }
  VY = sqrt(VY / ADC_SAMPLES);

  /***************** B Phase Voltage caluclations Begins Here ***************/
  B_max = 0;
  B_min = 4096;
  Measurement_CollectSamples(V_B_PHASE);
  for (i = 0; i < ADC_SAMPLES; i++) {
    if (RAW[i] > B_max)
      B_max = RAW[i];
    if (RAW[i] < B_min)
      B_min = RAW[i];
  }
  B_Offset = B_max - ((B_max - B_min) / 2);
  for (i = 0; i < ADC_SAMPLES; i++) {
    RAW[i] = RAW[i] - B_Offset;
    vac_val_B = RAW[i] * ADC_VOLT_RATIO;
    VB = VB + (vac_val_B * vac_val_B);
  }
  VB = sqrt(VB / ADC_SAMPLES);

  // --- Calculate Pre-Calibration Values ---
  float VR_Raw = VR * R_VOLTAGE_CORRECTION_FACTOR * VOLTAGE_MULTIPLIER;
  float VY_Raw = VY * Y_VOLTAGE_CORRECTION_FACTOR * VOLTAGE_MULTIPLIER;
  float VB_Raw = VB * B_VOLTAGE_CORRECTION_FACTOR * VOLTAGE_MULTIPLIER;

  // --- Apply Calibration ---
  // --- Apply Calibration ---
  VR = VR_Raw * GlobalSettings.CalibMult_Voltage_R;
  VY = VY_Raw * GlobalSettings.CalibMult_Voltage_Y;
  VB = VB_Raw * GlobalSettings.CalibMult_Voltage_B;

  // Debug Prints for Calibration (Restored per user request with limit)
  static uint32_t last_cal_print = 0;
  if (getMillis() - last_cal_print > 5000) {
    last_cal_print = getMillis();
    printf("VCal: R:%.1f Y:%.1f B:%.1f (Raw: %.1f, %.1f, %.1f)\r\n", VR, VY, VB,
           VR_Raw, VY_Raw, VB_Raw);
  }

  if (VR < COMPARE_VALUE_VOLT_PHASE_LOSS)
    VR = 0.0f;
  if (VY < COMPARE_VALUE_VOLT_PHASE_LOSS)
    VY = 0.0f;
  if (VB < COMPARE_VALUE_VOLT_PHASE_LOSS)
    VB = 0.0f;

  // --- Moving Average (32 Samples) ---
  if (!ma_initialized) {
    // First fill
    for (int j = 0; j < VOLT_MA_SIZE; j++) {
      ma_buffer_R[j] = VR;
      ma_buffer_Y[j] = VY;
      ma_buffer_B[j] = VB;
    }
    ma_sum_R = VR * VOLT_MA_SIZE;
    ma_sum_Y = VY * VOLT_MA_SIZE;
    ma_sum_B = VB * VOLT_MA_SIZE;
    ma_initialized = 1;
  } else {
    // Check for 30% deviation to enable fast response
    float cur_avg_R = ma_sum_R / VOLT_MA_SIZE;
    if (fabs(VR - cur_avg_R) > (cur_avg_R * 0.30f)) {
      for (int j = 0; j < VOLT_MA_SIZE; j++)
        ma_buffer_R[j] = VR;
      ma_sum_R = VR * VOLT_MA_SIZE;
    }

    float cur_avg_Y = ma_sum_Y / VOLT_MA_SIZE;
    if (fabs(VY - cur_avg_Y) > (cur_avg_Y * 0.30f)) {
      for (int j = 0; j < VOLT_MA_SIZE; j++)
        ma_buffer_Y[j] = VY;
      ma_sum_Y = VY * VOLT_MA_SIZE;
    }

    float cur_avg_B = ma_sum_B / VOLT_MA_SIZE;
    if (fabs(VB - cur_avg_B) > (cur_avg_B * 0.30f)) {
      for (int j = 0; j < VOLT_MA_SIZE; j++)
        ma_buffer_B[j] = VB;
      ma_sum_B = VB * VOLT_MA_SIZE;
    }
  }

  // Update Moving Average
  ma_sum_R -= ma_buffer_R[ma_index];
  ma_sum_Y -= ma_buffer_Y[ma_index];
  ma_sum_B -= ma_buffer_B[ma_index];

  ma_buffer_R[ma_index] = VR;
  ma_buffer_Y[ma_index] = VY;
  ma_buffer_B[ma_index] = VB;

  ma_sum_R += VR;
  ma_sum_Y += VY;
  ma_sum_B += VB;

  // Assign Averaged Values
  VR = ma_sum_R / VOLT_MA_SIZE;
  VY = ma_sum_Y / VOLT_MA_SIZE;
  VB = ma_sum_B / VOLT_MA_SIZE;

  // Increment Circular Index
  ma_index++;
  if (ma_index >= VOLT_MA_SIZE)
    ma_index = 0;

  // True Vector Sum using Fixed 120 Degree assumption
  // V_Line = sqrt(V1^2 + V2^2 - 2*V1*V2*cos(120))
  // cos(120) = -0.5
  // V_Line = sqrt(V1^2 + V2^2 + V1*V2)

  VRY = sqrt(VR * VR + VY * VY + VR * VY);
  VYB = sqrt(VY * VY + VB * VB + VY * VB);
  VRB = sqrt(VR * VR + VB * VB + VR * VB);
  float vrb_initial = VRB; // Capture calculated VRB for debugging

  // Update phaseloss_flag for protection and display
  if (VR < COMPARE_VALUE_VOLT_PHASE_LOSS) {
    phaseloss_flag = 1;
  } else if (VY < COMPARE_VALUE_VOLT_PHASE_LOSS) {
    phaseloss_flag = 2;
    yPhaseLossFlag = 1;
    yPhaseError = 1;
  } else if (VB < COMPARE_VALUE_VOLT_PHASE_LOSS) {
    phaseloss_flag = 3;
  } else {
    phaseloss_flag = 0;
    // Unified recovery check: If all voltages are well above threshold, clear
    // latched flags ONLY if sequence and juice line status is healthy.
    if (VR > 100.0f && VY > 100.0f && VB > 100.0f && ph_RatioFlag < 10) {
      yPhaseLossFlag = 0;
      yPhaseError = 0; // Clear error when all phases are healthy
    }
  }

  if ((GlobalSettings.Voltage_Over < VRY) ||
      (GlobalSettings.Voltage_Over < VYB) ||
      (GlobalSettings.Voltage_Over < VRB)) {
    overVoltageFlag = 1;
  } else {
    overVoltageFlag = 0;
  }

  // Removed standalone Y-recovery check (now in unified block above)

  // Debug: Check if VRB was modified significantly from initial calculation
  // when Y is lost Only print if there's a big discrepancy (e.g. clamp to VR/VB
  // vs vector sum)
  if (fabs(VRB - vrb_initial) > 50.0f) {
    static uint8_t drop_log_count = 0;
    if (drop_log_count < 20) {
      printf("VRB Drop: VR:%.2f VB:%.2f VY:%.2f Init:%.2f Final:%.2f "
             "Angle:%.2f\r\n",
             VR, VB, VY, vrb_initial, VRB, RbAngle);
      drop_log_count++;
    }
  }
  // --- Phase Loss Zeroing ---
  // If any phase is lost (< Threshold), force dependent line voltages to 0
  if (VR < VOLTAGE_ZERO_THRESHOLD) {
    VRY = 0.0f;
    if (VB > VOLTAGE_VALID_THRESHOLD) {
      VRB = VB;
    } else {
      VRB = 0.0f;
    }
  }
  if (VY < VOLTAGE_ZERO_THRESHOLD) {
    VRY = 0.0f;
    VYB = 0.0f;
  }
  if (VB < VOLTAGE_ZERO_THRESHOLD) {
    VYB = 0.0f;
    if (VR > VOLTAGE_VALID_THRESHOLD) {
      VRB = VR;
    } else {
      VRB = 0.0f;
    }
  }
  // Check specifically for Y phase loss AND (R or B phase loss)
  // If Y is gone, and either R or B is also gone/low, set VRB to the remaining
  // phase voltage. Original user logic was: "check absence of Y phase and any
  // one of R and B phase"
  // Check specifically for Y phase loss
  // logic changed to support single Y phase loss detection for LED status
  // Threshold increased to 20.0f to prevent noise from toggling flag
  /*if (VY < 20.0f) {
    if (VR > 75) {
      // Juice Line detected by angles. Check if confirmed.
      if (ph_RatioFlag >= 5) {
        yPhaseLossFlag = 1; // Force trip for juice line
        yPhaseError = 1;
      }
    } else if (VB > 75) {
      // Juice Line detected by angles. Check if confirmed.
      if (ph_RatioFlag >= 5) {
        yPhaseLossFlag = 1; // Force trip for juice line
        yPhaseError = 1;
      }
    }
  }*/
}

float Measurement_CalculatePhaseDiff(uint32_t time1, uint32_t time2) {
  uint32_t ticks;
  // Handle invalid data or failed ZCD
  if (time1 == 0 || time2 == 0) {
    return 0.0f; // Caller should handle default if 0.0 is returned
  }

  // 24-bit safe difference? or just normal diff since Timer2 is likely 32-bit?
  // Code says 24-bit safe difference comment, but implementation:
  // ticks = (time2 > time1) ? (time2 - time1) : (0x00FFFFFF - time1 + time2);
  // <- Commented out
  ticks = (time2 > time1) ? (time2 - time1) : (time1 - time2);

  // Convert to degrees
  float angle = (ticks / (float)(SystemCoreClock / 50)) * 360.0f;
  return angle;
}

void Measurement_CalcPhaseSequence(void) {
  uint16_t i, r_val, y_val, b_val, r_val_prev, y_val_prev, b_val_prev;
  uint32_t zcd_millis = getMillis();
  uint32_t sample_millis[3] = {0};
  float angle, angle1, angle2;
  r_val = y_val = b_val = r_val_prev = y_val_prev = b_val_prev = 0;
  i = 0;

  phaseSequenceCheckCount++;
  if (phaseSequenceCheckCount > 10) {
    phaseSequenceCheckCount = 10;
  } // Saturation

  ADC->ADCHER = (ADC->ADCHER & (~ADC_ADCHER_CHEN_Msk)) | (BIT0 | BIT1 | BIT2);

  float rAngleSamples[3] = {0}, yAngleSamples[3] = {0}, bAngleSamples[3] = {0};

  for (int k = 0; k < 3; k++) {
    uint32_t sample_millis[3] = {0};
    uint32_t loop_start_millis = getMillis();

    // Re-initialize ADC prev values for new burst
    ADC->ADCR |= ADC_ADCR_ADST_Msk;
    while (!(ADC->ADSR0 & ADC_ADSR0_ADF_Msk))
      ;
    ADC->ADSR0 = ADC_ADSR0_ADF_Msk;
    r_val_prev = ADC->ADDR[0] & ADC_ADDR_RSLT_Msk;
    y_val_prev = ADC->ADDR[1] & ADC_ADDR_RSLT_Msk;
    b_val_prev = ADC->ADDR[2] & ADC_ADDR_RSLT_Msk;

    while (getMillis() - loop_start_millis < 35) { // 35ms timeout per sample
      ADC->ADCR |= ADC_ADCR_ADST_Msk;
      while (!(ADC->ADSR0 & ADC_ADSR0_ADF_Msk))
        ;
      ADC->ADSR0 = ADC_ADSR0_ADF_Msk;

      r_val = ADC->ADDR[0] & ADC_ADDR_RSLT_Msk;
      y_val = ADC->ADDR[1] & ADC_ADDR_RSLT_Msk;
      b_val = ADC->ADDR[2] & ADC_ADDR_RSLT_Msk;

      if (((r_val_prev > ZCD_THRESHOLD) && (r_val <= ZCD_THRESHOLD)) &&
          sample_millis[0] == 0) {
        TIMER2_Init();
        TIMER2->CTL = TIMER_CTL_RSTCNT_Msk | TIMER_CTL_CNTEN_Msk;
        sample_millis[0] = TIMER2->CNT;
      }
      if (((y_val_prev > ZCD_THRESHOLD) && (y_val <= ZCD_THRESHOLD)) &&
          (sample_millis[1] == 0) && (sample_millis[0])) {
        sample_millis[1] = TIMER2->CNT;
      }
      if (((b_val_prev > ZCD_THRESHOLD) && (b_val <= ZCD_THRESHOLD)) &&
          (sample_millis[2] == 0) && (sample_millis[0])) {
        sample_millis[2] = TIMER2->CNT;
      }
      if (sample_millis[1] && sample_millis[2]) {
        break;
      }
      r_val_prev = r_val;
      y_val_prev = y_val;
      b_val_prev = b_val;
    }
    TIMER2->CTL &= ~TIMER_CTL_CNTEN_Msk; // Stop timer

    rAngleSamples[k] =
        Measurement_CalculatePhaseDiff(sample_millis[0], sample_millis[1]);
    yAngleSamples[k] =
        Measurement_CalculatePhaseDiff(sample_millis[1], sample_millis[2]);
    bAngleSamples[k] =
        Measurement_CalculatePhaseDiff(sample_millis[0], sample_millis[2]);
  }

  // Median Filtering (Simple Sort)
  // Sort R
  if (rAngleSamples[0] > rAngleSamples[1]) {
    float t = rAngleSamples[0];
    rAngleSamples[0] = rAngleSamples[1];
    rAngleSamples[1] = t;
  }
  if (rAngleSamples[1] > rAngleSamples[2]) {
    float t = rAngleSamples[1];
    rAngleSamples[1] = rAngleSamples[2];
    rAngleSamples[2] = t;
  }
  if (rAngleSamples[0] > rAngleSamples[1]) {
    float t = rAngleSamples[0];
    rAngleSamples[0] = rAngleSamples[1];
    rAngleSamples[1] = t;
  }
  float newRyAngle = rAngleSamples[1];

  // Sort Y
  if (yAngleSamples[0] > yAngleSamples[1]) {
    float t = yAngleSamples[0];
    yAngleSamples[0] = yAngleSamples[1];
    yAngleSamples[1] = t;
  }
  if (yAngleSamples[1] > yAngleSamples[2]) {
    float t = yAngleSamples[1];
    yAngleSamples[1] = yAngleSamples[2];
    yAngleSamples[2] = t;
  }
  if (yAngleSamples[0] > yAngleSamples[1]) {
    float t = yAngleSamples[0];
    yAngleSamples[0] = yAngleSamples[1];
    yAngleSamples[1] = t;
  }
  float newYbAngle = yAngleSamples[1];

  // Sort B
  if (bAngleSamples[0] > bAngleSamples[1]) {
    float t = bAngleSamples[0];
    bAngleSamples[0] = bAngleSamples[1];
    bAngleSamples[1] = t;
  }
  if (bAngleSamples[1] > bAngleSamples[2]) {
    float t = bAngleSamples[1];
    bAngleSamples[1] = bAngleSamples[2];
    bAngleSamples[2] = t;
  }
  if (bAngleSamples[0] > bAngleSamples[1]) {
    float t = bAngleSamples[0];
    bAngleSamples[0] = bAngleSamples[1];
    bAngleSamples[1] = t;
  }
  float newRbAngle = bAngleSamples[1];

  // Fast convergence on startup or reset
  if (phaseSequenceCheckCount < 5) {
    RyAngle = newRyAngle;
    YbAngle = newYbAngle;
    RbAngle = newRbAngle;
  } else {
    // Simple EMA smoothing (Weight 0.2 for new value)
    RyAngle = (RyAngle * 0.8f) + (newRyAngle * 0.2f);
    YbAngle = (YbAngle * 0.8f) + (newYbAngle * 0.2f);
    RbAngle = (RbAngle * 0.8f) + (newRbAngle * 0.2f);
  }

  // Sync with local variables for compatibility
  angle = RyAngle;
  angle1 = YbAngle;
  angle2 = RbAngle;

  // UART Debug Output - Throttled to 1s
  static uint32_t last_print_millis = 0;
  uint32_t current_millis = getMillis();

  if (current_millis - last_print_millis >= 1000) {
    last_print_millis = current_millis;
    // Printf removed to declutter output. Use MotorProtection.c for status.
  }

  // Forward Check (Typical: 120, 120, 240)
  if ((angle > 90 && angle < 150) && (angle1 > 90 && angle1 < 150) &&
      (angle2 > 210 && angle2 < 270)) {
    phaseSequenceCorrectFlag++;
    if (phaseSequenceCorrectFlag > 20) {
      phaseSequenceCorrectFlag = 20;
    }
    phaseSequenceReverseFlag = 0;
    ph_RatioFlag = 0;
    phaseNuetralConnectedFlag = 0; // Valid 3-Phase Angles
    yPhaseError = 0;               // Sequence is CORRECT
  }
  // Reverse Check (Typical: RY~240, YB~120, RB~120)
  else if ((angle > 210 && angle < 270) && (angle1 > 90 && angle1 < 150) &&
           (angle2 > 90 && angle2 < 150)) {
    phaseSequenceReverseFlag++;
    if (phaseSequenceReverseFlag > 20) {
      phaseSequenceReverseFlag = 20;
    }
    phaseSequenceCorrectFlag = 0;
    ph_RatioFlag = 0;
    phaseNuetralConnectedFlag = 1; // Mark as sequence issue
    yPhaseError = 1;               // Sequence is REVERSE
  } else {
    // Not Forward or Reverse (e.g. Phase Loss, Floating Phase, or Noise)
    if (phaseSequenceCorrectFlag > 0)
      phaseSequenceCorrectFlag--;
    if (phaseSequenceReverseFlag > 0)
      phaseSequenceReverseFlag--;

    phaseNuetralConnectedFlag = 1;
    // yPhaseError no longer set here to avoid premature OFF state during settling
  }

  // Explicit Juice line / Single phase short check (very wide angle overlap 45
  // deg)
  if (((VR > 75 && VY > 75) && (angle < 45 || angle > 315)) ||
      ((VY > 75 && VB > 75) && (angle1 < 45 || angle1 > 315)) ||
      ((VR > 75 && VB > 75) && (angle2 < 45 || angle2 > 315))) {

    phaseSequenceCorrectFlag = 0; // Immediately kill sequence confidence
    ph_RatioFlag++;
    if (ph_RatioFlag > 20) {
      ph_RatioFlag = 20;
      printf("Single Phasing or Juice Line\r\n");
      phaseNuetralConnectedFlag = 1;
      yPhaseError = 1;
    }
  } else {
    // NOT in Juice overlap window. Decrement the ratio flag so we can
    // transition to 2P
    if (ph_RatioFlag > 0) {
      ph_RatioFlag--;
    }
  }
}

uint8_t Measurement_CheckPhaseSequenceFlag(void) {
  static uint8_t was_in_phaseloss = 0;

  if (GlobalSettings.Voltage_PhaseSequenceCheck == 1) {
    if (yPhaseLossFlag) {
      phaseSequenceCheckCount = 0;
      phaseSequenceCorrectFlag = 0;
      phaseSequenceReverseFlag = 0;
      was_in_phaseloss = 1;
      // printf("Phase Seq return Phase loss\r\n");
      return 2;
    }

    // If we just recovered from phase loss, ensure we reset the counters to
    // give detection time
    if (was_in_phaseloss) {
      phaseSequenceCheckCount = 0;
      phaseSequenceCorrectFlag = 0;
      phaseSequenceReverseFlag = 0;
      was_in_phaseloss = 0;
    }

    // Explicitly check for Juice Line / Single Phasing Overlap
    if (ph_RatioFlag >= 1) {
      // Return 3 (Juice Line) to trigger 2P display instead of Phase Loss
      return 3;
    }

    if (phaseSequenceCorrectFlag > 5) {
      // printf("Phase Seq return Correct\r\n");
      return 1;
    } else if (phaseSequenceReverseFlag > 5) {
      // printf("Phase Seq return Reverse\r\n");
      return 0; // True Line Reverse
    } else {
      // DEBUG: Why are we here?
      static uint32_t last_seq_debug = 0;
      if (getMillis() - last_seq_debug > 2000) {
        last_seq_debug = getMillis();
        printf("Seq Settling: C:%d R:%d Ratio:%d RY:%.1f YB:%.1f RB:%.1f\r\n",
               phaseSequenceCorrectFlag, phaseSequenceReverseFlag, ph_RatioFlag,
               RyAngle, YbAngle, RbAngle);
      }
      return 2;
    }
  } else {
    // printf("Phase Seq return No Check Always True\r\n");
    return 1;
  }
}
