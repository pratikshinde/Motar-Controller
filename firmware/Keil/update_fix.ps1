$path = "..\Init_Settings.c"
$content = Get-Content $path -Raw

# Update wrap around logic: if > 500, set to 10 (min) instead of 50
$content = $content -replace "if\(count_val>500\)\s*\{\s*count_val\s*=\s*50;\s*\}", "if(count_val>500)`r`n				{`r`n					count_val = 10;`r`n				}"

# Also reduce the delay to make scrolling faster (optional but recommended)
# Look for Delay_ms(600) strictly after the logic we just touched
$content = $content -replace "if\(count_val>500\)`r`n				\{`r`n					count_val = 10;`r`n				\}(.|\n)*?Delay_ms\(600\);", "if(count_val>500)`r`n				{`r`n					count_val = 10;`r`n				}`r`n				sprintf(str,`"    %d/100`",count_val);`r`n				LCD_String(2,0,str);`r`n				Delay_ms(200);"

Set-Content $path $content -Encoding ASCII
