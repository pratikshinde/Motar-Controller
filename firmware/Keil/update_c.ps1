$path = "..\Init_Settings.c"
$content = Get-Content $path -Raw
# Replace CURRENT_CALIBRATION_MULTIPLIER with dynamic runtime check
# The replacement text includes CURRENT_CALIBRATION_MULTIPLIER as the fallback constant
$content = $content -replace "CURRENT_CALIBRATION_MULTIPLIER", "(GlobalSettings.CT_Ratio > 0.0001f ? GlobalSettings.CT_Ratio : CURRENT_CALIBRATION_MULTIPLIER)"
Set-Content $path $content -Encoding ASCII
