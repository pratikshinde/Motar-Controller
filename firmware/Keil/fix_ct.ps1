$h_path = "..\Init_Settings.h"
$c_path = "..\Init_Settings.c"

# 1. Remove the float CT_Ratio from Header
$h_content = Get-Content $h_path -Raw
# Regex to remove lines containing "float CT_Ratio;" with spaces
$h_content = $h_content -replace "\s*float CT_Ratio;\s*", "`r`n"
Set-Content $h_path $h_content -Encoding ASCII

# 2. Update readCurrent in Init_Settings.c
$c_content = Get-Content $c_path -Raw
# Revert previous dynamic check to clean slate, then apply correct logic
# Previous edit replaced "CURRENT_CALIBRATION_MULTIPLIER" with "(GlobalSettings.CT_Ratio > 0.0001f ? ...)"
# We want to replace that whole expression with a new calculations
$old_logic = "\(GlobalSettings.CT_Ratio > 0.0001f \? GlobalSettings.CT_Ratio : CURRENT_CALIBRATION_MULTIPLIER\)"
$new_logic = "(CURRENT_CALIBRATION_MULTIPLIER * (GlobalSettings.CTRatio > 0 ? (float)GlobalSettings.CTRatio/100.0f : 1.0f))"

if ($c_content -match $old_logic) {
    $c_content = $c_content -replace $old_logic, $new_logic
}
else {
    # If previous replace failed or format differs, try replacing just CURRENT_CALIBRATION_MULTIPLIER again
    # BUT we need to be careful not to double-replace if it's already there.
    # Given the previous step seemed successful, we expect the old_logic pattern.
    # Fallback: Just search for the fallback constant if the complex expression isn't found
    $c_content = $c_content -replace "CURRENT_CALIBRATION_MULTIPLIER", $new_logic
}

# 3. Fix the Menu Limit (around line 3100)
# Look for "if(count_val>50)" inside CT_RATIO_SETTINGS block
# We can be specific: "if(count_val>50)" -> "if(count_val>500)"
$c_content = $c_content -replace "if\(count_val>50\)", "if(count_val>500)"

Set-Content $c_path $c_content -Encoding ASCII
