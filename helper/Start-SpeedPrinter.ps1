param([string]$Orca = 'C:\Program Files\OrcaSlicer\orca-slicer.exe')
$ErrorActionPreference = 'Stop'
python (Join-Path $PSScriptRoot 'server.py') --orca $Orca
