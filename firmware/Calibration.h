#ifndef __CALIBRATION_H__
#define __CALIBRATION_H__

#include <stdint.h>

void Calibration_Init(void);
void Calibration_Check(void);
void UART02_IRQHandler(void);

#endif // __CALIBRATION_H__
