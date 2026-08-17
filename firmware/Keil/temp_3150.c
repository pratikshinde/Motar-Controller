					count_val--;
				}
				sprintf(str,"    %d/100",count_val);
				LCD_String(2,0,str);
				Delay_ms(600);
			}
			else if(sw_val == BUTTON_SAVE)
			{
				//break;
				if(!saveButtonPressFlag)
				{
					saveButtonPressFlag = 1;
					saveButtonPressMillis = getMillis();
				}
				if(saveButtonPressFlag && ((getMillis()-saveButtonPressMillis)>4000))
				{
					goto SAVE_SETTINGS;
				}
			}
			else
			{
				if(saveButtonPressFlag)
				{
					saveButtonPressFlag = 0;
				}
			}			
			GlobalSettings.CTRatio = count_val;
			printf("CTRatio: %d\r\n",GlobalSettings.CTRatio);
			
		}
  }
	/********************** Timing Settings -> PH Ratio  *********************/
	PH_RATIO_SETTINGS:
	settingCount = 15;
	setting_milis = getMillis();
	//LCD_Clear();
	while((getMillis() - setting_milis) < 1500);
	//option_select_millis = getMillis();
	if(GlobalSettings.state)
	{
		LCD_Clear();
		printf("SV PHRatio: %d",GlobalSettings.PHRatio);
		count_val = GlobalSettings.PHRatio;
		//LCD_String(1,0,"12)Set On Time");
		sprintf(str,"%d) **PH Ratio**",settingCount);
		LCD_String(1,0,str);
		sprintf(str,"    %d Percent",GlobalSettings.PHRatio);
		LCD_String(2,0,str);		
		//LCD_String(2,0,str);
	}	
