# 打包商店用 zip（Windows PowerShell）
# 用法：在仓库根目录执行  .\scripts\pack.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = '0.0.1'
$manifestPath = Join-Path $root 'manifest.json'
if (Test-Path $manifestPath) {
  $m = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($m.version) { $version = [string]$m.version }
}

$dist = Join-Path $root 'dist'
$stage = Join-Path $dist ('stage-' + $version)
$zipName = "bilibili-name-history-$version.zip"
$zipPath = Join-Path $dist $zipName

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
New-Item -ItemType Directory -Path $dist -Force | Out-Null

$include = @(
  'manifest.json',
  'icons',
  'src'
)

foreach ($item in $include) {
  $src = Join-Path $root $item
  $dst = Join-Path $stage $item
  if (-not (Test-Path $src)) { throw "missing: $item" }
  Copy-Item -Path $src -Destination $dst -Recurse -Force
}

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -Force
Remove-Item $stage -Recurse -Force

$info = Get-Item $zipPath
Write-Host "OK: $($info.FullName) ($([math]::Round($info.Length/1KB,1)) KB)"
