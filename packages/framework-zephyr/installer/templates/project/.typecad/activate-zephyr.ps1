# ---------------------------------------------------------------------------
# typeCAD Zephyr - per-project env activator (PowerShell).
#
# Run:     . .\.typecad\activate-zephyr.ps1
# Auto-run on terminal open: see .vscode/settings.json in this template.
#
# Activates the micromamba env created by the typeCAD Zephyr installer. After
# activation, `west` is on PATH and ZEPHYR_BASE / ZEPHYR_SDK_INSTALL_DIR point
# at the new install, so `npx typecad-hal build` uses it automatically.
#
# Override the env name with $TYPECAD_ZEPHYR_ENV (default: "zephyr").
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$EnvName = if ($env:TYPECAD_ZEPHYR_ENV) { $env:TYPECAD_ZEPHYR_ENV } else { 'zephyr' }

# Load the micromamba shell hook if it isn't already available (e.g. this shell
# was launched with -NoProfile, or shell init hasn't been run on this machine).
if (-not (Get-Command micromamba -ErrorAction SilentlyContinue)) {
  $mm = Join-Path $env:USERPROFILE 'micromamba\Library\bin\micromamba.exe'
  if (-not (Test-Path $mm)) {
    throw "micromamba not found at $mm. Run the typeCAD Zephyr installer first: node packages/framework-zephyr/installer/install.mjs"
  }
  # NB: the `| Invoke-Expression` pipe form fails under PowerShell (it parses
  # the multi-line hook line-by-line). Capture as an array, join with newlines.
  Invoke-Expression ((& $mm shell hook -s powershell) -join [char]10)
}

micromamba activate $EnvName

Write-Host "typeCAD Zephyr: activated '$EnvName' -> $((Get-Command west -ErrorAction SilentlyContinue).Source)" -ForegroundColor DarkGray
Write-Host "  ZEPHYR_BASE = $env:ZEPHYR_BASE" -ForegroundColor DarkGray
