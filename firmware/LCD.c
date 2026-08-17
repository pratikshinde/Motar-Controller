#include "LCD.h"
#include "NuMicro.h"

// Initialize LCD
void LCD_Init() {
  /*
                      RS-> PC14
                      EN-> PB15
                      D4-> PB14
                      D5-> PB13
                      D6-> PB12
                      D7-> PB7
              */

  /* Configure Output mode */
  // PB->MODE = (PB->MODE &
  // ~(GPIO_MODE_MODE7_Msk|GPIO_MODE_MODE12_Msk|GPIO_MODE_MODE13_Msk|GPIO_MODE_MODE14_Msk|GPIO_MODE_MODE15_Msk))
  // | (GPIO_MODE_OUTPUT <<
  // (GPIO_MODE_MODE7_Pos|GPIO_MODE_MODE12_Pos|GPIO_MODE_MODE13_Pos|GPIO_MODE_MODE14_Pos|GPIO_MODE_MODE15_Pos));

  PB->MODE = (PB->MODE & ~(GPIO_MODE_MODE7_Msk)) |
             (GPIO_MODE_OUTPUT << GPIO_MODE_MODE7_Pos);
  PB->MODE = (PB->MODE & ~(GPIO_MODE_MODE12_Msk)) |
             (GPIO_MODE_OUTPUT << GPIO_MODE_MODE12_Pos);
  PB->MODE = (PB->MODE & ~(GPIO_MODE_MODE13_Msk)) |
             (GPIO_MODE_OUTPUT << GPIO_MODE_MODE13_Pos);
  PB->MODE = (PB->MODE & ~(GPIO_MODE_MODE14_Msk)) |
             (GPIO_MODE_OUTPUT << GPIO_MODE_MODE14_Pos);
  PB->MODE = (PB->MODE & ~(GPIO_MODE_MODE15_Msk)) |
             (GPIO_MODE_OUTPUT << GPIO_MODE_MODE15_Pos);

  PC->MODE = (PC->MODE & ~(GPIO_MODE_MODE14_Msk)) |
             (GPIO_MODE_OUTPUT << (GPIO_MODE_MODE14_Pos));
  // PC->MODE = (PC->MODE & ~(GPIO_MODE_MODE1_Msk)) | (GPIO_MODE_INPUT <<
  // GPIO_MODE_MODE1_Pos);

  // LCD_Init_Sequence(0xFF);
  Delay_ms(50);  // Extended power-on delay (50ms)
                 // Reset sequence for 4-bit mode
  LCD_Cmd(0x03); // First try to set 8-bit mode
  Delay_ms(10);  // Wait for more than 4.1ms
  LCD_Cmd(0x03); // Second try
  Delay_ms(1);   // Wait for more than 100us
  LCD_Cmd(0x03); // Third try
  Delay_ms(1);
  LCD_Cmd(0x02); // Finally set to 4-bit mode
  Delay_ms(1);

  LCD_Cmd(0x28);
  // Delay_ms(2);
  LCD_Cmd(0x0C); // Display on, cursor off
                 // Delay_ms(2);
  LCD_Cmd(0x06); // Increment cursor, no shift
                 // Delay_ms(2);
  LCD_Cmd(0x01); // Clear display
                 // LCD_Cmd(0x80);
  Delay_ms(200);
}

// Helper function to write to LCD data pins
void LCD_Port(unsigned char dat) {
  LCD_D4 = (dat >> 0) & 1;
  LCD_D5 = (dat >> 1) & 1;
  LCD_D6 = (dat >> 2) & 1;
  LCD_D7 = (dat >> 3) & 1;
}
void LCD_Init_Sequence(unsigned char dat) {
  LCD_D4 = (dat >> 0) & 1;
  LCD_D5 = (dat >> 1) & 1;
  LCD_D6 = (dat >> 2) & 1;
  LCD_D7 = (dat >> 3) & 1;
  LCD_EN = 1; // High pulse
  Delay_ms(1);
  LCD_EN = 0;
}

// Send command to LCD
void LCD_Cmd(unsigned char cmd) {
  LCD_Port(cmd >> 4); // Upper nibble
  LCD_RS = 0;         // Command mode
  // LCD_RW = 0;         // Write mode
  LCD_EN = 1; // High pulse
  CLK_SysTickDelay(50);
  LCD_EN = 0;

  LCD_Port(cmd & 0x0F); // Lower nibble
  LCD_EN = 1;           // High pulse
  CLK_SysTickDelay(50);
  LCD_EN = 0;
}

// Send data to LCD
void LCD_Data(unsigned char dat) {
  LCD_Port(dat >> 4); // Upper nibble
  LCD_RS = 1;         // Data mode
  // LCD_RW = 0;         // Write mode
  LCD_EN = 1; // High pulse
  CLK_SysTickDelay(50);
  LCD_EN = 0;

  LCD_Port(dat & 0x0F); // Lower nibble
  LCD_EN = 1;           // High pulse
  CLK_SysTickDelay(50);
  LCD_EN = 0;
}

// Display string on LCD
void LCD_String(int32_t line_number, int32_t pos, char *str) {

  if (line_number == 1) {
    LCD_Cmd(0x80 + pos); // Move cursor to line 1
  } else {
    LCD_Cmd(0xC0 + pos); // Move cursor to line 2
  }
  while (*str) {
    LCD_Data(*str++);
  }
}

// Delay in milliseconds
void Delay_ms(uint32_t ms) {
  uint32_t delay, u32Prescale;
  u32Prescale = 32;
  while (ms--) {
    TIMER0->CTL &= ~(TIMER_CTL_CNTEN_Msk);
    // printf("Delay 1 second\n");
    TIMER0->CMP = __HIRC / u32Prescale / 1000;
    TIMER0->CTL =
        (TIMER0->CTL & ~(TIMER_CTL_OPMODE_Msk | TIMER_CTL_PSC_Msk)) |
        (TIMER_ONESHOT_MODE | (u32Prescale - 1) | TIMER_CTL_CNTEN_Msk);

    for (delay = (SystemCoreClock / __HIRC) + 1; delay > 0; delay--) {
      __NOP();
    }
    while (TIMER0->CTL & TIMER_CTL_ACTSTS_Msk)
      ;
  }
}
void LCD_Clear(void) {
  LCD_Cmd(0x01);
  Delay_ms(20);
}
