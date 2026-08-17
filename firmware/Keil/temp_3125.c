			{
				//option_select_millis = getMillis();
				count_val++;
				if(count_val>500)
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
