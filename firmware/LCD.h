#ifndef __LCD__
#define __LCD__

#include "NuMicro.h"
#include "config.h"

#define LCD_RS PIN_LCD_RS
#define LCD_EN PIN_LCD_EN

#define LCD_D4 PIN_LCD_D4
#define LCD_D5 PIN_LCD_D5
#define LCD_D6 PIN_LCD_D6
#define LCD_D7 PIN_LCD_D7

void LCD_Init();
void LCD_Cmd(unsigned char cmd);
void LCD_Data(unsigned char dat);
void Delay_ms(uint32_t ms);
void LCD_Port(unsigned char dat);
void LCD_String(int32_t line_number, int32_t pos, char *str);
void LCD_Init_Sequence(unsigned char dat);
void LCD_Clear(void);
#endif
