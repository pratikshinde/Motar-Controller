#include "Init_Settings.h"
#include "NuMicro.h"
#include "fmc.h"
#include "stdio.h"

#define FLASH_ADDR 0xFE00
#define TOTAL_RUN_ADDR 0xFC00
void Write_Struct_To_Flash(GlobalSettings_t *data) {
  uint32_t *pData = (uint32_t *)data;
  uint32_t u32Size = (sizeof(GlobalSettings_t) + 3) / 4; // Size in 32-bit words
  uint32_t result;
  // printf("\n***FMC Function Size:%ul***",sizeof(GlobalSettings_t));
  // Unlock Flash
  SYS_UnlockReg();
  FMC_Open();
  FMC_ENABLE_AP_UPDATE();
  printf("\r\nFMC Open Return");
  // Erase the Flash page (required before writing)
  result = FMC_Erase(FLASH_ADDR);
  printf("\r\nPage Erase Return %d^^^^", result);
  // Write the structure to Flash (32-bit words)
  for (int i = 0; i < u32Size; i++) {
    result = FMC_Write(FLASH_ADDR + (i * 4), pData[i]);
    printf("Count %d Return %d\r\n", i, result);
  }
  printf("\nPage written");
  // Lock Flash
  FMC_Close();
  printf("\nFMC Close");
  SYS_LockReg();
}

void Read_Struct_From_Flash(GlobalSettings_t *data) {
  uint32_t *pData = (uint32_t *)data;
  uint32_t u32Size = (sizeof(GlobalSettings_t) + 3) / 4;
  SYS_UnlockReg(); // Unlock protected registers
  printf("\nFMC Read");
  SYS_UnlockReg();
  FMC_Open();
  // Read Flash data
  // SAFE: Use FMC_Read instead of direct pointer access
  for (int i = 0; i < u32Size; i++) {
    pData[i] = FMC_Read(FLASH_ADDR + (i * 4));
  }
  FMC_Close();
  SYS_LockReg();
}
void Write_RunTime_To_Flash(uint32_t *totalRunTime) {
  uint32_t u32Size = 1; // Size in 32-bit words
  uint32_t *pData = (uint32_t *)totalRunTime;
  uint32_t result;
  // Unlock Flash
  SYS_UnlockReg();
  FMC_Open();
  FMC_ENABLE_AP_UPDATE();
  printf("\r\nFMC Open Return");
  // Erase the Flash page (required before writing)
  result = FMC_Erase(TOTAL_RUN_ADDR);
  printf("\r\nPage Erase Return %d^^^^", result);
  // Write the structure to Flash (32-bit words)
  result = FMC_Write(TOTAL_RUN_ADDR, pData[0]);
  result = FMC_Write(TOTAL_RUN_ADDR + 4, pData[1]);

  printf("Return %d\r\n", result);
  printf("\nPage written");
  // Lock Flash
  FMC_Close();
  printf("\nFMC Close");
  SYS_LockReg();
}

void Read_RunTime_From_Flash(uint32_t *totalRunTime) {
  uint32_t u32Size = 1;
  uint32_t *pData = (uint32_t *)totalRunTime;
  SYS_UnlockReg(); // Unlock protected registers
  printf("\nFMC Read");
  SYS_UnlockReg();
  FMC_Open();
  // Read Flash data
  // SAFE: Use FMC_Read instead of direct pointer access
  pData[0] = FMC_Read(TOTAL_RUN_ADDR);
  pData[1] = FMC_Read(TOTAL_RUN_ADDR + 4);
  FMC_Close();
  SYS_LockReg();
}
