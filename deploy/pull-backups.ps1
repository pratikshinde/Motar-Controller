# Copies the server's database backups (and nothing else) to this PC, so they exist on a second machine.
#
#     .\deploy\pull-backups.ps1                          # copies new files into %USERPROFILE%\AjantaBackups
#     .\deploy\pull-backups.ps1 -Dest D:\Backups -Make   # first asks the server to take a fresh backup right now
#
# It only ADDS files here: nothing on the server is deleted or changed (except -Make, which runs one extra backup), and a file
# already copied is skipped. It never copies .env, the Firebase key or the AWS keys.
# Needs the server's SSH key (default %USERPROFILE%\Downloads\agripump-key.pem) and the `ssh`/`scp` that come with Windows.
# Keep the destination OUTSIDE OneDrive if the database holds personal data you do not want in the cloud sync, and check that
# the folder is on a disk that is itself backed up.
param(
  [string]$Server = 'ubuntu@52.66.187.110',
  [string]$Key    = (Join-Path $env:USERPROFILE 'Downloads\agripump-key.pem'),
  [string]$Remote = '~/Motar-Controller',
  [string]$Dest   = (Join-Path $env:USERPROFILE 'AjantaBackups'),
  [switch]$Make,
  [int]$KeepLocalDays = 90
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Key)) { throw "SSH key not found: $Key" }
New-Item -ItemType Directory -Force $Dest | Out-Null
$ssh = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15')

if ($Make) {
  Write-Host 'Asking the server for a fresh backup...'
  & ssh @ssh $Server "cd $Remote && docker compose run --rm -e BACKUP_RUN_ONCE=1 backup"
  if ($LASTEXITCODE -ne 0) { throw "The server could not make a backup (exit $LASTEXITCODE)." }
}

# One line per backup file: name and size, so a half-written file is never taken.
$list = & ssh @ssh $Server "cd $Remote/backups && ls -1 agripump-*.dump 2>/dev/null | while read f; do echo `"`$f `$(wc -c < `$f)`"; done"
if ($LASTEXITCODE -ne 0) { throw "Could not list the backups on the server (exit $LASTEXITCODE)." }
$files = @($list | Where-Object { $_ -match '^agripump-\d{8}-\d{6}\.dump \d+$' })
if ($files.Count -eq 0) { throw 'The server has no backup files. Run again with -Make, and check that the backup container is part of the running stack (profile "db").' }

$copied = 0
foreach ($line in $files) {
  $name, $size = $line -split ' '
  $target = Join-Path $Dest $name
  if ((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target).Length -eq [int64]$size)) { continue }
  Write-Host "Copying $name ($([math]::Round([int64]$size / 1MB, 1)) MB)"
  & scp @ssh "${Server}:$Remote/backups/$name" "$target.partial"
  if ($LASTEXITCODE -ne 0) { Remove-Item -LiteralPath "$target.partial" -ErrorAction SilentlyContinue; throw "scp failed for $name" }
  if ((Get-Item -LiteralPath "$target.partial").Length -ne [int64]$size) { Remove-Item -LiteralPath "$target.partial"; throw "$name arrived with the wrong size" }
  Move-Item -LiteralPath "$target.partial" -Destination $target -Force
  $copied++
}
Get-ChildItem -LiteralPath $Dest -Filter 'agripump-*.dump' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepLocalDays) } | Remove-Item -Force
$newest = Get-ChildItem -LiteralPath $Dest -Filter 'agripump-*.dump' | Sort-Object Name | Select-Object -Last 1
Write-Host ("Done: {0} new file(s) copied. Newest on this PC: {1} ({2:N1} MB) in {3}" -f $copied, $newest.Name, ($newest.Length / 1MB), $Dest)
