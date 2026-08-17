#ifndef __SETTINGS_EEPROM__
#define __SETTINGS_EEPROM__

void Write_Struct_To_Flash(GlobalSettings_t *data);
void Read_Struct_From_Flash(GlobalSettings_t *data);
void Write_RunTime_To_Flash(uint32_t *totalRunTime);
void Read_RunTime_From_Flash(uint32_t *totalRunTime);

#endif


