#include "Init_Settings.h"
#include "LCD.h"
#include "Measurement.h" // For yPhaseError
#include "MotorProtection.h"
#include "NuMicro.h"
#include "SettingsEEPROM.h"
#include "Timer3_Int.h"
#include "config.h"
#include "uart.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

volatile uint8_t toggle = 0;
GlobalSettings_t GlobalSettings;

void TMR1_IRQHandler(void) {
  TIMER1->INTSTS |= TIMER_INTSTS_TIF_Msk; // Clear interrupt flag

  // Skip LED control during Power-On Delay state
  if (state == STATE_POWER_ON_DELAY) {

    return;
  }

  toggle = !toggle; // Toggle every 100ms (HW Interrupt)

  // Simplified ISR: Just blink if Timer1 is running.
  LED_YEL = toggle;
}

void Timer1_Disable(void) {
  TIMER1->CTL &= ~TIMER_CTL_CNTEN_Msk;
  TIMER1->INTSTS |= TIMER_INTSTS_TIF_Msk;
}

void Timer1_Enable(void) {
  TIMER1->CTL |= TIMER_CTL_CNTEN_Msk; // Just set CNTEN bit
  NVIC_EnableIRQ(TMR1_IRQn);
}

void Init_Timer1_100ms(void) {
  uint32_t u32Prescale = 32;
  TIMER1->CTL = (TIMER1->CTL & ~(TIMER_CTL_OPMODE_Msk | TIMER_CTL_PSC_Msk)) |
                (TIMER_PERIODIC_MODE | (u32Prescale - 1) | TIMER_CTL_INTEN_Msk);
  // Set CMP for 100ms interval: __HIRC / u32Prescale / 10
  TIMER1->CMP = __HIRC / u32Prescale / 10;
  // TIMER1->CTL |= TIMER_CTL_CNTEN_Msk; // Do not enable at boot
  NVIC_EnableIRQ(TMR1_IRQn);
}

void writeSettingEEPROM(void) {
  Write_Struct_To_Flash(&GlobalSettings);
  printf("\r\nSaved...");
}

void InitGPIO(void) {
  SYS_UnlockReg();

  // init RED, YELLOW and BLUE Status LEDs as OUTPUT
  // Clear MFP bits for PA12, PA13, PA14 to set them to GPIO mode (0x00)
  SYS->GPA_MFPH &= ~(0x000F0000 | 0x00F00000 | 0x0F000000);

  PA->MODE = (PA->MODE & ~(GPIO_MODE_MODE12_Msk)) |
             (GPIO_MODE_OUTPUT << GPIO_MODE_MODE12_Pos);
  PA->MODE = (PA->MODE & ~(GPIO_MODE_MODE13_Msk)) |
             (GPIO_MODE_OUTPUT << GPIO_MODE_MODE13_Pos);
  PA->MODE = (PA->MODE & ~(GPIO_MODE_MODE14_Msk)) |
             (GPIO_MODE_OUTPUT << GPIO_MODE_MODE14_Pos);
  // RELAY pins
  PA->MODE = (PA->MODE & ~(GPIO_MODE_MODE7_Msk)) |
             (GPIO_MODE_OUTPUT << GPIO_MODE_MODE7_Pos);
  PA->MODE = (PA->MODE & ~(GPIO_MODE_MODE6_Msk)) |
             (GPIO_MODE_OUTPUT << GPIO_MODE_MODE6_Pos);

  // SW Pin (PA10) and SW1 Pin (PA11)
  PA->MODE = (PA->MODE & ~(GPIO_MODE_MODE10_Msk | GPIO_MODE_MODE11_Msk)) |
             (GPIO_MODE_QUASI << GPIO_MODE_MODE10_Pos) |
             (GPIO_MODE_QUASI << GPIO_MODE_MODE11_Pos);
  RELAY = 0;
  RELAY1 = 0;
  Timer1_Disable(); // Ensure no early LED interrupts
}

void readSettingsEEPROM(void) {
  extern uint32_t TotalRunTime[2];
  extern uint16_t completedMinutesInCurrentCycle;
  Read_Struct_From_Flash(&GlobalSettings);
  // Clamp HP_Settings to valid range (respects ENABLE_LOW_LOAD_SETTINGS)
  if (GlobalSettings.HP_Settings < HP_SETTING_MIN)
    GlobalSettings.HP_Settings = HP_SETTING_MIN;
  if (GlobalSettings.HP_Settings > HP_SETTING_MAX)
    GlobalSettings.HP_Settings = HP_SETTING_MAX;

  Read_RunTime_From_Flash(TotalRunTime);
  printf("\r\n[DEBUG] Read Flash TotalRunTime: [0]=%u, [1]=%u", TotalRunTime[0],
         TotalRunTime[1]);
  completedMinutesInCurrentCycle = (uint16_t)TotalRunTime[1];
  printf("\r\n[DEBUG] Restored completedMinutesInCurrentCycle: %u",
         completedMinutesInCurrentCycle);
  printf("\r\n[DEBUG] Init Addr Tot:%p, Comp:%p", (void *)TotalRunTime,
         (void *)&completedMinutesInCurrentCycle);

  printf("\r\n--- MCU SETTINGS ---");
  printf("\r\nST1: %d, ST2: %d", GlobalSettings.state, GlobalSettings.state2);
  printf("\r\nCurr: Load:%dA, OL:%dA, Dry:%dA, CTR:%d",
         GlobalSettings.Current_Load, GlobalSettings.Current_OverLoad,
         GlobalSettings.Current_DryRun, GlobalSettings.CTRatio);
  printf("\r\nVolt: UV:%dV, OV:%dV, IMB:%d%%, PS:%d, PHR:%d",
         GlobalSettings.Voltage_Under, GlobalSettings.Voltage_Over,
         GlobalSettings.Voltage_Imbalance,
         GlobalSettings.Voltage_PhaseSequenceCheck, GlobalSettings.PHRatio);
  printf(
      "\r\nTime: Dry:%ds, OL:%ds, On:%dm, RST:%dm, DR_RST:%dm, AS:%ds, SD:%ds",
      GlobalSettings.Timing_DryRun, GlobalSettings.Timing_OverLoad,
      GlobalSettings.Timing_MotOnTime, GlobalSettings.Timing_MotRestartTime,
      GlobalSettings.Timing_DryRunReset, GlobalSettings.Timing_AutoStart,
      GlobalSettings.Timing_StarDeltaDelay);
  printf("\r\nMisc: HP:%d, AR:%d, Cyc:%d", GlobalSettings.HP_Settings,
         GlobalSettings.AutoRestart, GlobalSettings.CyclicTimer);
  printf("\r\nRunTime (Total): %02u:%02u (HH:MM)", TotalRunTime[0] / 60,
         TotalRunTime[0] % 60);
  printf("\r\nRunTime (Current Cycle): %u min", completedMinutesInCurrentCycle);
  printf("\r\n--------------------\r\n");

  if ((GlobalSettings.state == 1) && (GlobalSettings.state2 == 90)) {
    // Valid settings
  } else {
    // Default settings
    printf("\r\n!!!! INVALID SETTINGS DETECTED -> RESETTING TO DEFAULTS (v90) "
           "!!!!");
    GlobalSettings.state = 1;
    GlobalSettings.state2 = 90;
    GlobalSettings.Current_Load = 25;
    GlobalSettings.Current_OverLoad = 25;
    GlobalSettings.Current_DryRun = 1;
    GlobalSettings.HP_Settings = 3; // 3 = 7.5HP
    GlobalSettings.Voltage_Under = 180;
    GlobalSettings.Voltage_Over = 500;
    GlobalSettings.Voltage_Imbalance = 35;
    GlobalSettings.Voltage_PhaseSequenceCheck = 1;
    GlobalSettings.AutoRestart = 0;
    GlobalSettings.CyclicTimer = 0;
    GlobalSettings.Timing_DryRun = 5;
    GlobalSettings.Timing_OverLoad = 7;
    GlobalSettings.Timing_MotOnTime = 0;
    GlobalSettings.Timing_MotRestartTime = 0;
    GlobalSettings.Timing_DryRunReset = 0;
    GlobalSettings.Timing_StarDeltaDelay = 5;
    GlobalSettings.Timing_AutoStart = 10;
    GlobalSettings.CTRatio = 4; // 4/100 Ratio

    GlobalSettings.PHRatio = 10;

    // Default Calibration Multipliers
    GlobalSettings.CalibMult_Voltage_R = 1.0f;
    GlobalSettings.CalibMult_Voltage_Y = 1.0f;
    GlobalSettings.CalibMult_Voltage_B = 1.0f;
    GlobalSettings.CalibMult_Current_R = 1.0f;
    GlobalSettings.CalibMult_Current_Y = 1.0f;
    GlobalSettings.CalibMult_Current_B = 1.0f;

    writeSettingEEPROM();
    TotalRunTime[0] = 0;
    TotalRunTime[1] = 0;
    Write_RunTime_To_Flash(TotalRunTime);
    printf("\r\nDefaults written to Flash.");
  }
}

void SYS_Init(void) {
  SYS_UnlockReg();
  CLK->PWRCTL |= CLK_PWRCTL_HIRCEN_Msk;
  while ((CLK->STATUS & CLK_STATUS_HIRCSTB_Msk) != CLK_STATUS_HIRCSTB_Msk)
    ;
  CLK->CLKSEL0 =
      (CLK->CLKSEL0 & ~CLK_CLKSEL0_HCLKSEL_Msk) | CLK_CLKSEL0_HCLKSEL_HIRC;
  CLK->CLKDIV0 =
      (CLK->CLKDIV0 & ~CLK_CLKDIV0_HCLKDIV_Msk) | CLK_CLKDIV0_HCLK(1);
  CLK->PCLKDIV = (CLK_PCLKDIV_APB0DIV_DIV2 | CLK_PCLKDIV_APB1DIV_DIV2);
  CLK->CLKSEL1 =
      (CLK->CLKSEL1 & ~CLK_CLKSEL1_UART0SEL_Msk) | CLK_CLKSEL1_UART0SEL_HIRC;
  CLK->CLKDIV0 =
      (CLK->CLKDIV0 & ~CLK_CLKDIV0_UART0DIV_Msk) | CLK_CLKDIV0_UART0(1);
  CLK->APBCLK0 |= (CLK_APBCLK0_UART0CKEN_Msk | CLK_APBCLK0_ADCCKEN_Msk |
                   CLK_APBCLK0_TMR0CKEN_Msk | CLK_APBCLK0_TMR1CKEN_Msk |
                   CLK_APBCLK0_TMR3CKEN_Msk | CLK_APBCLK0_TMR2CKEN_Msk);
  CLK->CLKSEL2 =
      (CLK->CLKSEL2 & ~CLK_CLKSEL2_ADCSEL_Msk) | CLK_CLKSEL2_ADCSEL_PCLK1;
  CLK->CLKDIV0 = (CLK->CLKDIV0 & ~CLK_CLKDIV0_ADCDIV_Msk) | CLK_CLKDIV0_ADC(3);
  CLK->CLKSEL1 =
      (CLK->CLKSEL1 & ~(CLK_CLKSEL1_TMR0SEL_Msk | CLK_CLKSEL1_TMR1SEL_Msk |
                        CLK_CLKSEL1_TMR3SEL_Msk)) |
      (CLK_CLKSEL1_TMR0SEL_HIRC | CLK_CLKSEL1_TMR1SEL_HIRC |
       CLK_CLKSEL1_TMR3SEL_HIRC | CLK_CLKSEL1_TMR2SEL_HIRC);
  SystemCoreClockUpdate();

  SYS->GPF_MFPL =
      (SYS->GPF_MFPL & ~(SYS_GPF_MFPL_PF2MFP_Msk | SYS_GPF_MFPL_PF3MFP_Msk)) |
      (SYS_GPF_MFPL_PF2MFP_UART0_RXD | SYS_GPF_MFPL_PF3MFP_UART0_TXD);
  PB->MODE &=
      ~(GPIO_MODE_MODE0_Msk | GPIO_MODE_MODE1_Msk | GPIO_MODE_MODE2_Msk |
        GPIO_MODE_MODE3_Msk | GPIO_MODE_MODE4_Msk | GPIO_MODE_MODE5_Msk);
  SYS->GPB_MFPL =
      (SYS->GPB_MFPL & ~(SYS_GPB_MFPL_PB0MFP_Msk | SYS_GPB_MFPL_PB1MFP_Msk |
                         SYS_GPB_MFPL_PB2MFP_Msk | SYS_GPB_MFPL_PB3MFP_Msk |
                         SYS_GPB_MFPL_PB4MFP_Msk | SYS_GPB_MFPL_PB5MFP_Msk |
                         SYS_GPB_MFPL_PB6MFP_Msk)) |
      (SYS_GPB_MFPL_PB0MFP_ADC0_CH0 | SYS_GPB_MFPL_PB1MFP_ADC0_CH1 |
       SYS_GPB_MFPL_PB2MFP_ADC0_CH2 | SYS_GPB_MFPL_PB3MFP_ADC0_CH3 |
       SYS_GPB_MFPL_PB4MFP_ADC0_CH4 | SYS_GPB_MFPL_PB5MFP_ADC0_CH5 |
       SYS_GPB_MFPL_PB6MFP_ADC0_CH6);
  PB->DINOFF |= ((BIT6 | BIT5 | BIT4 | BIT3 | BIT2 | BIT1 | BIT0)
                 << GPIO_DINOFF_DINOFF0_Pos);
  PA->MODE = (PA->MODE & ~GPIO_MODE_MODE8_Msk) |
             (GPIO_MODE_INPUT << GPIO_MODE_MODE8_Pos);
  PF->MODE = (PF->MODE & ~(GPIO_MODE_MODE5_Msk | GPIO_MODE_MODE4_Msk) |
              (GPIO_MODE_INPUT << GPIO_MODE_MODE5_Pos | GPIO_MODE_MODE4_Pos));

  SYS_LockReg();
}

void UART0_Init(void) {
  SYS->IPRST1 |= SYS_IPRST1_UART0RST_Msk;
  SYS->IPRST1 &= ~SYS_IPRST1_UART0RST_Msk;
  UART0->BAUD = UART_BAUD_MODE2 | UART_BAUD_MODE2_DIVIDER(__HIRC, 115200);
  UART0->LINE = UART_WORD_LEN_8 | UART_PARITY_NONE | UART_STOP_BIT_1;

  // Enable UART0 RDA (Receive Data Available) Interrupt
  UART0->INTEN |= UART_INTEN_RDAIEN_Msk;
  NVIC_EnableIRQ(UART02_IRQn);
}
