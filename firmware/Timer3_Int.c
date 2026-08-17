#include "Timer3_Int.h"
#include "stdio.h"
#include "M031Series.h"
volatile uint32_t timer3_millis;
void TMR3_IRQHandler(void)
{
    if(TIMER3->INTSTS & TIMER_INTSTS_TIF_Msk)
    {
        /* Clear Timer3 time-out interrupt flag */
        TIMER3->INTSTS = TIMER_INTSTS_TIF_Msk;
        timer3_millis++;
    }
}
void initTimer3(void)
{
	uint32_t u32Prescale = 32;
	TIMER3->CTL = (TIMER3->CTL & ~(TIMER_CTL_OPMODE_Msk | TIMER_CTL_PSC_Msk)) | (TIMER_PERIODIC_MODE | (u32Prescale-1) | TIMER_CTL_INTEN_Msk);
	TIMER3->CMP = __HIRC / u32Prescale / 1000;
	
	NVIC_EnableIRQ(TMR3_IRQn);//Enable Interrupt
	TIMER3->CTL |= TIMER_CTL_CNTEN_Msk;
	printf("Timestamping Initialized\n");

}
uint32_t getMillis(void)
{

	return timer3_millis;
}

void TIMER2_Init(void) {
    // 1. Enable TIMER2 clock
    CLK->APBCLK0 |= CLK_APBCLK0_TMR2CKEN_Msk;
    
    // 2. Configure periodic mode (20ms period for 50Hz)
    TIMER2->CTL = TIMER_CTL_RSTCNT_Msk;       // Reset counter
    TIMER2->CTL &= ~TIMER_ONESHOT_MODE;    // Disable one-shot
    TIMER2->CMP = 0x00FFFFFF;  ;       // Auto-reload value (20ms)
    
    // 3. Start timer (CNT will reset to 0 automatically)
    //TIMER2->CTL |= TIMER_CTL_CNTEN_Msk;
}

