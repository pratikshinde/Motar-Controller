			}
			else if(sw_val == BUTTON_PREV)
			{
				settingCount--;
				goto MOT_ON_TIMING;
			}
			else if(sw_val == BUTTON_DOWN)
			{
				//option_select_millis = getMillis();
				if(count_val>0)
				{
					count_val--;
				}
				if(count_val)
				{
					sprintf(str,"Time: %02d Mins ",count_val);
				}
				else
				{
					snprintf(str,sizeof(str),"   Restart Off  ");
				}
				LCD_String(2,0,str);
				Delay_ms(200);
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
			GlobalSettings.Timing_MotRestartTime = count_val;
			printf("Timing_MotOn: %d\r\n",GlobalSettings.Timing_MotRestartTime);
			
		}
  }
	/********************** Timing Settings -> CT Ratio  *********************/
	CT_RATIO_SETTINGS:
	settingCount = 14;
	setting_milis = getMillis();
	//LCD_Clear();
	while((getMillis() - setting_milis) < 1500);
	//option_select_millis = getMillis();
	if(GlobalSettings.state)
	{
		LCD_Clear();
		printf("SV CTRatio: %d",GlobalSettings.CTRatio);
		count_val = GlobalSettings.CTRatio;
		//LCD_String(1,0,"12)Set On Time");
		sprintf(str,"%d) **CT Ratio**",settingCount);
		LCD_String(1,0,str);
		sprintf(str,"    %d/100",GlobalSettings.CTRatio);
		LCD_String(2,0,str);		
		//LCD_String(2,0,str);
	}	
	while(1)//Dry Run Time out Settings in seconds, Range 0 to 999s
	{
		if(getMillis()-setting_milis>SETTING_BUTTON_CHK_TIME)
		{
			setting_milis  = getMillis();
			sw_val = readButton() ;
			if(sw_val == BUTTON_UP)
			{
				//option_select_millis = getMillis();
				count_val++;
				if(count_val>50)
				{
					count_val = 50;
				}
				sprintf(str,"    %d/100",count_val);
				LCD_String(2,0,str);
				Delay_ms(600);
			}
			else if(sw_val == BUTTON_NEXT)
			{
				break;
			}
			else if(sw_val == BUTTON_PREV)
			{
				settingCount--;
				goto MOT_RESTART_TIMING;
			}
			else if(sw_val == BUTTON_DOWN)
			{
				//option_select_millis = getMillis();
				if(count_val>10)
				{
