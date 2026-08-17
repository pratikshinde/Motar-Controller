$path = "..\Init_Settings.h"
$content = Get-Content $path -Raw
$content = $content -replace "\} GlobalSettings_t;", "`r`n    float CT_Ratio;`r`n} GlobalSettings_t;"
Set-Content $path $content -Encoding ASCII
