#ifndef __UI_MENU_H__
#define __UI_MENU_H__

#include "Init_Settings.h"
#include "NuMicro.h"
#include "config.h"

// External Variables
extern uint32_t saveButtonPressMillis;
extern uint32_t saveButtonPressFlag;

// Function Prototypes
uint16_t UI_ReadButton(void);
void UI_DisplayParameters(uint8_t line);
void UI_SettingsMenu(void);
uint32_t UI_PowerOnDelay(void);
void UI_BootPhaseCheck(void);

#endif // __UI_MENU_H__
