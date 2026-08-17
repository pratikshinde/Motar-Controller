/**
 ******************************************************************************
 * @file    sc_application.c
 * @author  SIMCom OpenSDK Team
 * @brief   Source code for SIMCom OpenSDK application, void userSpace_Main(void
 * * arg) is the app entry for OpenSDK application,customer should start
 * application from this call.
 ******************************************************************************
 * @attention
 *
 * Copyright (c) 2022 SIMCom Wireless.
 * All rights reserved.
 *
 ******************************************************************************
 */

/* Includes ------------------------------------------------------------------*/
#include "simcom_uart.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// #include <unistd.h>

#include "simcom_debug.h"
#include "simcom_os.h"
#include "userspaceConfig.h"


#if defined SIMCOM_PROTOCOL_V2

#include "sal_os.h"

#ifdef HAS_DEMO
#include "simcom_demo_init.h"
#endif // HAS_DEMO

// for userSpace_Main
#define MAIN_STACK_SIZE (1024 * 4)
char stack_main[MAIN_STACK_SIZE];

char *mainStack = stack_main;
int mainStackSize = MAIN_STACK_SIZE;
enum sal_task_priority mainPriority = sal_task_priority_low_1;

extern char UserSpaceVersion[40];
// for userSpace_Main end

/**
 * @brief  OpenSDK app entry.
 * @param  Pointer arg
 * @note   This is the app entry,like main(),all functions must start from
 * here!!!!!!
 * @retval void
 */
void userSpace_Main(void *arg) {
#ifdef APP_VERSION
  strncpy(UserSpaceVersion, APP_VERSION, sizeof(UserSpaceVersion));
#endif
  sAPI_enableDUMP();
  /*  UI demo task for customer with CLI method for all demo running,
      customer need to define SIMCOM_UI_DEMO_TO_USB_AT_PORT or
      SIMCOM_UI_DEMO_TO_UART1_PORT to select hardware interface.
  */
#ifdef HAS_DEMO
  sAPI_TaskSleep(
      200); // Wait for USB initialization to complete and print catstudio log.

  simcom_demo_init();
#endif

  printf("user app is running...");
}

#elif defined SIMCOM_PROTOCOL_V1

#include "api_map.h"
#include "mqtt_bridge.h"

#ifndef FALCON_1803_PLATFORM
#ifdef HAS_DEMO
#include "app_version.h"
#endif

#ifdef PROJECT_TBDTU
#include "dtu_version.h"
#endif
#endif

#ifdef HAS_DEMO
#ifdef HAS_UART
#include "uart_api.h"
#endif

extern void sAPP_SimcomUIDemo(void);
extern void sAPP_HelloWorldDemo(void);
extern void sAPP_UrcTask(void);
extern void sc_Set_URCtask_flag(UINT8 value);
extern void sAPP_UsbVcomTask(void);
#ifdef CSD_SUPPORT
extern void RecCsdDatdemo(void);
#endif
#endif

#ifdef PROJECT_YSZNBG
#include "ezhal.h"
extern void sAPP_UrcTask(void);
#endif

#define sleep(x) sAPI_TaskSleep((x) * 200)

/**
 * @brief  OpenSDK app entry.
 * @param  Pointer arg
 * @note   This is the app entry,like main(),all functions must start from
 * here!!!!!!
 * @retval void
 */
void userSpace_Main(void *arg) {
  /*  simcom api init. Do not modify!  */
  ApiMapInit(arg);
  // sAPI_enableDUMP();
  /*  UI demo task for customer with CLI method for all demo running,
      customer need to define SIMCOM_UI_DEMO_TO_USB_AT_PORT or
      SIMCOM_UI_DEMO_TO_UART1_PORT to select hardware interface.
  */
#ifdef HAS_DEMO
  sleep(5); // Wait for USB initialization to complete and print catstudio log.

#ifdef HAS_URC
  sAPP_UrcTask();
#if 0
    sc_Set_URCtask_flag(1);//tell sim_urc task has been created
#endif
#ifdef CSD_SUPPORT
  RecCsdDatdemo();
#endif
#endif
#ifdef HAS_USB
  sAPP_UsbVcomTask();
#endif
  sAPP_HelloWorldDemo();

#ifdef HAS_UART
  sDemo_UartInit();
  // sAPP_SimcomUIDemo();
#endif
#endif

#ifdef PROJECT_YSZNBG
  extern void ez_main(void *arg);
  sTaskRef eziot_task_ref = NULL;
  sAPI_TaskCreate(&eziot_task_ref, NULL, 1024 * 20, 120, "eziot main task",
                  ez_main, NULL);
  sAPP_UrcTask();
#endif

#ifdef PROJECT_TBDTU
  extern void dtu_Main(void *arg);
  sTaskRef dtu_task_ref = NULL;
  sAPI_TaskCreate(&dtu_task_ref, NULL, 1024 * 20, 120, "dtu main task",
                  dtu_Main, NULL);
#endif

#ifdef PROJECT_LYTBOX
  extern void lytbox_Main(void *arg);
  sTaskRef lytbox_task_ref = NULL;
  sAPI_TaskCreate(&lytbox_task_ref, NULL, 1024 * 20, 120, "lytbox main task",
                  lytbox_Main, NULL);
#endif

#ifdef PROJECT_TOPFLY
  extern void topfly_Main(void *arg);
  sTaskRef topfly_task_ref = NULL;
  sAPI_TaskCreate(&topfly_task_ref, NULL, 1024 * 20, 120, "topfly main task",
                  topfly_Main, NULL);
#endif

  /* Start Swathi Switchgear MQTT Bridge */
  sAPP_MqttBridgeInit();

  printf("user app is running...");
}

void abort(void) {
  printf("abort!!!");
  while (1)
    ;
}

#define _appRegTable_attr_                                                     \
  __attribute__((unused, section(".userSpaceRegTable")))

#define appMainStackSize (1024 * 10)

#ifndef APP_VERSION
#define APP_VERSION ""
#endif
userSpaceEntry_t userSpaceEntry _appRegTable_attr_ = {
    NULL,           NULL,       appMainStackSize, 30, "userSpaceMain",
    userSpace_Main, APP_VERSION};

#endif
