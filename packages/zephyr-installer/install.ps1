# ---------------------------------------------------------------------------
# typeCAD Zephyr installer - Windows PowerShell bootstrap.
#
# Native Windows install of a working Zephyr build environment via micromamba.
# Mirrors install.sh step-for-step so users without Git Bash get the same
# one-command experience from PowerShell.
#
#   1. download micromamba (win-64 static exe)
#   2. create the conda env (west, cmake, ninja, gperf, pyelftools, ...)
#   3. install activation hooks that set ZEPHYR_BASE + ZEPHYR_SDK_INSTALL_DIR
#   4. fetch + extract the official Zephyr SDK bundle (.7z)
#   5. west init + west update a vanilla Zephyr workspace
#
# Usage:
#   pwsh -File install.ps1 [-DryRun] [-NoSdk] [-NoWorkspace]
#                         [-EnvName NAME] [-SdkVersion VER]
#
# After install: `micromamba activate zephyr` (after `micromamba shell hook`)
# and framework-zephyr discovers west via PATH + ZEPHYR_BASE automatically.
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$NoSdk,
  [switch]$NoWorkspace,
  [switch]$Modify,
  [string]$EnvName,
  [string]$SdkVersion,
  [string]$Platforms
)

$ErrorActionPreference = 'Stop'
$PackageDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Invoke a native executable and throw on non-zero exit. PowerShell's
# $ErrorActionPreference='Stop' does NOT apply to native exes (micromamba.exe,
# curl.exe, 7z.exe, tar.exe) — without this guard they fail silently, set
# $LASTEXITCODE, and the script cascades into a false "done". Every host tool
# call goes through this so a failure aborts with context.
function Invoke-Native {
  param([scriptblock]$Block, [string]$Description)
  & $Block
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed (exit $LASTEXITCODE)"
  }
}

# --- load versions.env into script-scoped variables -------------------------
function Load-VersionsEnv {
  param([string]$Path)
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#')) {
      $idx = $line.IndexOf('=')
      if ($idx -gt 0) {
        $key = $line.Substring(0, $idx).Trim()
        $val = $line.Substring($idx + 1).Trim()
        # Strip optional surrounding double quotes (multi-word values like
        # PLATFORM_esp32 carry a space-separated toolchain list).
        if ($val.StartsWith('"') -and $val.EndsWith('"') -and $val.Length -ge 2) {
          $val = $val.Substring(1, $val.Length - 2)
        }
        Set-Variable -Name $key -Value $val -Scope Script
      }
    }
  }
}
Load-VersionsEnv "$PackageDir\versions.env"

# Download via curl.exe (the real Windows curl, shipped on Win10 1803+), not
# Invoke-WebRequest. The .NET HttpWebRequest stack that Invoke-WebRequest uses
# resolves DNS through the system/IE proxy path, which can FAIL to resolve a
# host (e.g. api.anaconda.org behind the micro.mamba.pm redirect) even when the
# OS resolver and curl succeed. curl.exe resolves directly and adds retry/resume.
# NB: PowerShell aliases `curl` -> Invoke-WebRequest, so call `curl.exe` explicitly.
function Download-File {
  param([string]$Url, [string]$OutFile)
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    Invoke-Native { & $curl.Source -fL --retry 3 -C - -o "$OutFile" "$Url" } "download $Url"
  } else {
    # Fallback for rare Windows machines without curl.exe (pre-1803).
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
  }
}

# Windows' native tar.exe (bsdtar). Invoked explicitly because a Git-Bash/MSYS
# `tar` earlier on PATH mis-parses C:\ paths as host:path remote syntax
# ("Cannot connect to C:"). Ships on Win10 1803+ alongside curl.exe.
$TarExe = Join-Path $env:SystemRoot 'System32\tar.exe'

# Apply CLI overrides.
if ($EnvName)     { $script:ENV_NAME = $EnvName }
if ($SdkVersion)  { $script:ZEPHYR_SDK_VERSION = $SdkVersion }

# --- platform detection (Windows only; the SDK ships no arm64 Windows bundle) -
$MambaPlat  = 'win-64'
$SdkPlat    = 'windows-x86_64'
$ArchiveExt = '7z'

# --- path resolution --------------------------------------------------------
if (-not $env:MAMBA_ROOT_PREFIX) { $env:MAMBA_ROOT_PREFIX = Join-Path $env:USERPROFILE 'micromamba' }
if (-not $env:WORKSPACE_DIR)     { $env:WORKSPACE_DIR     = Join-Path $env:USERPROFILE 'zephyrproject' }
$EnvPrefix = Join-Path $env:MAMBA_ROOT_PREFIX "envs\$ENV_NAME"
# The SDK lives OUTSIDE the conda env prefix: `micromamba create` requires the
# prefix to be empty, and a failed create must not trap a multi-GB SDK download.
# Keeping them decoupled means env create/remove never threatens the SDK.
if (-not $env:SDK_INSTALL_PARENT){ $env:SDK_INSTALL_PARENT = Join-Path $env:MAMBA_ROOT_PREFIX 'zephyr-sdk' }
$ZephyrSdkInstallDir = Join-Path $env:SDK_INSTALL_PARENT "zephyr-sdk-$ZEPHYR_SDK_VERSION"
$MambaExe            = Join-Path $env:MAMBA_ROOT_PREFIX 'Library\bin\micromamba.exe'

# --- plan printer (mirrors install.sh's [plan] tags) ------------------------
$bundle = "zephyr-sdk-$ZEPHYR_SDK_VERSION`_$SdkPlat.$ArchiveExt"
Write-Host "[plan] typeCAD Zephyr installer"
Write-Host "[plan]   env name:          $ENV_NAME"
Write-Host "[plan]   conda subdir:      $MambaPlat"
Write-Host "[plan]   sdk platform:      $SdkPlat"
Write-Host "[plan]   sdk version:       $ZEPHYR_SDK_VERSION"
Write-Host "[plan]   platforms:         $(if ($Platforms) { $Platforms } else { 'all' })"
Write-Host "[plan]   sdk bundle:        $bundle"
Write-Host "[plan]   sdk bundle url:    $SDK_RELEASE_BASE/v$ZEPHYR_SDK_VERSION/$bundle"
Write-Host "[plan]   micromamba url:    $MICROMAMBA_BASE/$MambaPlat/latest"
Write-Host "[plan]   micromamba bin:    $MambaExe"
Write-Host "[plan]   env prefix:        $EnvPrefix"
Write-Host "[plan]   sdk install dir:   $ZephyrSdkInstallDir"
Write-Host "[plan]   workspace dir:     $env:WORKSPACE_DIR"
Write-Host "[plan]   zephyr base:       $(Join-Path $env:WORKSPACE_DIR 'zephyr')"
Write-Host "[plan]   manifest url:      $ZEPHYR_MANIFEST_URL"
Write-Host "[plan]   manifest rev:      $ZEPHYR_MANIFEST_REV"
Write-Host "[plan]   do sdk:            $(-not $NoSdk.IsPresent)"
Write-Host "[plan]   do workspace:      $(-not $NoWorkspace.IsPresent)"

if ($DryRun) {
  Write-Host "[plan] DRY-RUN - no downloads, no env created."
  exit 0
}

# --- 1. micromamba ----------------------------------------------------------
if (-not (Test-Path $MambaExe)) {
  Write-Host "micromamba: downloading ($MambaPlat)..."
  New-Item -ItemType Directory -Force -Path $env:MAMBA_ROOT_PREFIX | Out-Null
  $tmp = Join-Path $env:TEMP 'typecad-micromamba.tar.bz2'
  Download-File -Url "$MICROMAMBA_BASE/$MambaPlat/latest" -OutFile $tmp
  # Win10+ ships tar.exe (bsdtar), which auto-detects .tar.bz2 compression.
  Push-Location $env:MAMBA_ROOT_PREFIX
  try { Invoke-Native { & $TarExe xf $tmp } "micromamba extract" } finally { Pop-Location }
  Remove-Item $tmp -Force
  if (-not (Test-Path $MambaExe)) {
    $found = Get-ChildItem -Path $env:MAMBA_ROOT_PREFIX -Recurse -Filter 'micromamba.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $MambaExe = $found.FullName } else { throw "micromamba: binary not found after extract" }
  }
  Write-Host "micromamba: installed at $MambaExe"
} else {
  Write-Host "micromamba: already present at $MambaExe"
}

# Register the micromamba shell hook in the user's PowerShell profile so
# `micromamba` resolves and `micromamba activate <env>` works in NEW shells.
# This is required because the download above placed micromamba.exe under
# $MAMBA_ROOT_PREFIX\Library\bin\, which is NOT on PATH by default. The hook
# both adds it and defines the activate/deactivate functions. (The pipe form
# `... | Invoke-Expression` and the naive `Invoke-Expression "$(...)"` form both
# fail under PowerShell because multi-line output collapses to spaces;
# installing to the profile is the robust path.)
Write-Host "micromamba: registering shell hook in your PowerShell profile..."
Invoke-Native { & $MambaExe shell init -s powershell -r $env:MAMBA_ROOT_PREFIX } "micromamba shell init"

# --- 2. conda env -----------------------------------------------------------
if (Test-Path (Join-Path $EnvPrefix 'conda-meta')) {
  Write-Host "env: '$ENV_NAME' already exists - updating"
  Invoke-Native { & $MambaExe env update -y -f "$PackageDir\environment.yml" -p $EnvPrefix } "env update"
} elseif (Test-Path $EnvPrefix) {
  # Prefix dir exists but is NOT a valid conda env (no conda-meta). This is the
  # residue of a prior failed run; `micromamba create` would abort with
  # "Non-conda folder exists at prefix". Surface it rather than auto-deleting a
  # dir that may hold a multi-GB SDK.
  throw @"
env: '$EnvPrefix' exists but is not a valid conda env (no conda-meta).
This is usually left by a prior failed install. Remove it and re-run:
  Remove-Item -Recurse -Force '$EnvPrefix'
(If a zephyr-sdk-* folder is inside it, it's safe to delete - the SDK is fetched fresh.)
"@
} else {
  Write-Host "env: creating '$ENV_NAME' from environment.yml..."
  Invoke-Native { & $MambaExe create -y -f "$PackageDir\environment.yml" -n $ENV_NAME } "env create"
}

# 7zip: required to extract the .7z Windows SDK bundle. conda-forge ships it
# for win-64. Warn-and-continue here; the fetch-sdk step re-checks 7z and
# throws a clear error if it's truly unavailable (e.g. pre-1803 Windows).
Write-Host "env: installing 7zip (for .7z SDK extraction)..."
& $MambaExe install -y -n $ENV_NAME -c conda-forge 7zip
if ($LASTEXITCODE -ne 0) {
  Write-Warning "env: 7zip install failed (exit $LASTEXITCODE) - SDK .7z extraction will need 7z.exe elsewhere."
}

# --- 3. activation hooks ----------------------------------------------------
$actDst   = Join-Path $EnvPrefix 'etc\conda\activate.d'
$deactDst = Join-Path $EnvPrefix 'etc\conda\deactivate.d'
New-Item -ItemType Directory -Force -Path $actDst, $deactDst | Out-Null
$zb = Join-Path $env:WORKSPACE_DIR 'zephyr'

# Resolved env-vars (PowerShell + cmd). Values live here; hooks stay static.
@(
  "# Resolved by the typeCAD Zephyr installer. Dot-sourced by activate.d/zephyr.ps1.",
  "`$env:TYPECAD_ZEPHYR_BASE = `"$zb`"",
  "`$env:TYPECAD_ZEPHYR_SDK_INSTALL_DIR = `"$ZephyrSdkInstallDir`""
) -join "`n" | Set-Content -NoNewline (Join-Path $EnvPrefix 'etc\conda\env-vars.ps1')

@"
@echo off
set `"TYPECAD_ZEPHYR_BASE=$zb`"
set `"TYPECAD_ZEPHYR_SDK_INSTALL_DIR=$ZephyrSdkInstallDir`"
"@ | Set-Content (Join-Path $EnvPrefix 'etc\conda\env-vars.bat')

Copy-Item "$PackageDir\etc\conda\activate.d\zephyr.ps1"  (Join-Path $actDst 'zephyr.ps1')   -Force
Copy-Item "$PackageDir\etc\conda\activate.d\zephyr.bat"  (Join-Path $actDst 'zephyr.bat')   -Force
Copy-Item "$PackageDir\etc\conda\deactivate.d\zephyr.ps1" (Join-Path $deactDst 'zephyr.ps1') -Force
Copy-Item "$PackageDir\etc\conda\deactivate.d\zephyr.bat" (Join-Path $deactDst 'zephyr.bat') -Force
Write-Host "write-activation: done"

# --- 4. Zephyr SDK (.7z) ----------------------------------------------------
if (-not $NoSdk) {
  # Locate 7z once (used by both full-bundle and selective paths).
  # Normalize to the executable path: Get-ChildItem yields a FileInfo (.FullName),
  # Get-Command yields a CommandInfo (.Source) - only one of which is populated.
  $sevenz = Get-ChildItem -Path $EnvPrefix -Recurse -Filter '7z.exe' -ErrorAction SilentlyContinue `
            | Select-Object -First 1 -ExpandProperty FullName
  if (-not $sevenz) { $found = Get-Command 7z -ErrorAction SilentlyContinue; if ($found) { $sevenz = $found.Source } }
  if (-not $sevenz) { $sevenz = $null }  # only fatal when extraction is needed

  $sel = if ($Platforms) { $Platforms } else { 'all' }
  Write-Host "fetch-sdk: platform selection: $sel"

  if ($sel -eq 'all') {
    # ── FULL BUNDLE (current behavior) ──────────────────────────────────────
    # Idempotent: the SDK full bundle ships a top-level `sdk_version` file once
    # extracted, so its presence means the SDK is already in place.
    if (Test-Path (Join-Path $ZephyrSdkInstallDir 'sdk_version')) {
      Write-Host "fetch-sdk: already present at $ZephyrSdkInstallDir - skipping download"
    } else {
      $url = "$SDK_RELEASE_BASE/v$ZEPHYR_SDK_VERSION/$bundle"
      Write-Host "fetch-sdk: downloading full bundle $bundle from $url"
      New-Item -ItemType Directory -Force -Path $env:SDK_INSTALL_PARENT | Out-Null
      $archive = Join-Path $env:SDK_INSTALL_PARENT $bundle
      Download-File -Url $url -OutFile $archive
      # Verify (skip when TODO).
      $checksumVar = 'SHA256_' + ($SdkPlat -replace '-', '_')
      $expected = (Get-Variable -Name $checksumVar -ErrorAction SilentlyContinue).Value
      $actual = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower()
      if (-not $expected -or $expected -eq 'TODO') {
        Write-Warning "fetch-sdk: SHA256 not pinned (TODO in versions.env); computed: $actual"
      } elseif ($actual -ne $expected.ToLower()) {
        throw "fetch-sdk: SHA256 mismatch (expected $expected, got $actual)"
      } else {
        Write-Host "fetch-sdk: sha256 OK ($actual)"
      }
      if (-not $sevenz) { throw "fetch-sdk: 7z.exe not found in env or on PATH" }
      Invoke-Native { & $sevenz x -y "-o$env:SDK_INSTALL_PARENT" $archive } "fetch-sdk 7z extract"
      Remove-Item $archive -Force
      Write-Host "fetch-sdk: done - $ZephyrSdkInstallDir"
    }
  } else {
    # ── SELECTIVE: minimal bundle + individual toolchains ───────────────────
    $minimal = "zephyr-sdk-$ZEPHYR_SDK_VERSION`_$SdkPlat`_minimal.$ArchiveExt"
    $minimalUrl = "$SDK_RELEASE_BASE/v$ZEPHYR_SDK_VERSION/$minimal"

    if ($DryRun) {
      Write-Host "fetch-sdk: [DRY-RUN] would download minimal $minimalUrl (~10 MB)"
      Write-Host "fetch-sdk: [DRY-RUN] selected platforms: $sel"
      foreach ($grp in $sel.Split(',')) {
        $tv = (Get-Variable -Name "PLATFORM_$grp" -ErrorAction SilentlyContinue).Value
        Write-Host "fetch-sdk: [DRY-RUN]   ${grp}: $tv"
      }
    } else {
      New-Item -ItemType Directory -Force -Path $env:SDK_INSTALL_PARENT | Out-Null

      # 1. Minimal bundle (cmake/ + sdk_version — ~10 MB).
      if (Test-Path (Join-Path $ZephyrSdkInstallDir 'sdk_version')) {
        Write-Host "fetch-sdk: SDK base already present - skipping minimal bundle"
      } else {
        Write-Host "fetch-sdk: downloading minimal bundle (~10 MB)"
        $minArchive = Join-Path $env:SDK_INSTALL_PARENT $minimal
        Download-File -Url $minimalUrl -OutFile $minArchive
        if (-not $sevenz) { throw "fetch-sdk: 7z.exe not found in env or on PATH" }
        Invoke-Native { & $sevenz x -y "-o$env:SDK_INSTALL_PARENT" $minArchive } "fetch-sdk minimal extract"
        Remove-Item $minArchive -Force
      }

      # 2. Individual toolchains per selected platform group.
      foreach ($grp in $sel.Split(',')) {
        $targets = (Get-Variable -Name "PLATFORM_$grp" -ErrorAction SilentlyContinue).Value
        if (-not $targets) {
          Write-Warning "fetch-sdk: unknown platform group '$grp' (no PLATFORM_$grp in versions.env); skipping"
          continue
        }
        Write-Host "fetch-sdk: platform '${grp}':"
        foreach ($target in $targets.Split(' ')) {
          if (-not $target) { continue }
          if (Test-Path (Join-Path $ZephyrSdkInstallDir $target)) {
            Write-Host "fetch-sdk:   $target - already installed, skipping"
            continue
          }
          $tcBundle = "toolchain_${SdkPlat}_${target}.${ArchiveExt}"
          $tcUrl = "$SDK_RELEASE_BASE/v$ZEPHYR_SDK_VERSION/$tcBundle"
          Write-Host "fetch-sdk:   $target - downloading $tcBundle"
          $tcArchive = Join-Path $env:SDK_INSTALL_PARENT $tcBundle
          Download-File -Url $tcUrl -OutFile $tcArchive
          if (-not $sevenz) { throw "fetch-sdk: 7z.exe not found in env or on PATH" }
          Invoke-Native { & $sevenz x -y "-o$ZephyrSdkInstallDir" $tcArchive } "fetch-sdk $target extract"
          Remove-Item $tcArchive -Force
        }
      }

      # 3. Remove toolchains installed but NOT in the new selection (--modify removal).
      $selectedTargets = @()
      foreach ($grp in $sel.Split(',')) {
        $t = (Get-Variable -Name "PLATFORM_$grp" -ErrorAction SilentlyContinue).Value
        if ($t) { $selectedTargets += $t.Split(' ') }
      }
      Get-ChildItem -Path $ZephyrSdkInstallDir -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^(xtensa-)?.*-zephyr-(eabi|elf)$' } |
        ForEach-Object {
          if ($selectedTargets -notcontains $_.Name) {
            Write-Host "fetch-sdk: removing deselected toolchain: $($_.Name)"
            Remove-Item -Recurse -Force $_.FullName
          }
        }

      # 4. Persist the selection.
      Set-Content -Path (Join-Path $ZephyrSdkInstallDir '.typecad-platforms') -Value $sel
      Write-Host "fetch-sdk: done - $ZephyrSdkInstallDir (platforms: $sel)"
    }
  }
} else {
  Write-Host "install: -NoSdk - skipping Zephyr SDK download"
}

# --- 5. west workspace ------------------------------------------------------
if ($Modify) { Write-Host "install: -Modify - skipping west workspace" }
elseif (-not $NoWorkspace) {
  Write-Host "init-workspace: west init $env:WORKSPACE_DIR"
  $westDir = Join-Path $env:WORKSPACE_DIR '.west'
  $westConfig = Join-Path $westDir 'config'
  if ((Test-Path $westDir) -and (Test-Path $westConfig)) {
    Write-Host "init-workspace: already initialized - running west update only"
  } else {
    if (Test-Path $westDir) {
      Write-Host "init-workspace: .west exists but its config is missing (interrupted init?) - re-initializing"
      Remove-Item -Recurse -Force $westDir
    }
    $parent = Split-Path -Parent $env:WORKSPACE_DIR
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Invoke-Native { & $MambaExe run -n $ENV_NAME west init -m $ZEPHYR_MANIFEST_URL --mr $ZEPHYR_MANIFEST_REV $env:WORKSPACE_DIR } "west init"
  }
  Write-Host "init-workspace: running west update (fetches zephyr + modules)..."
  Invoke-Native { & $MambaExe run -n $ENV_NAME west update } "west update"
  # Install Zephyr's pinned Python build deps (jsonschema, pykwalify, ...). CMake
  # checks for these and the build fails with "Missing jsonschema dependency"
  # without them; letting Zephyr's requirements file drive it tracks the revision.
  Write-Host "init-workspace: installing Zephyr Python requirements (requirements-base.txt)..."
  Invoke-Native { & $MambaExe run -n $ENV_NAME pip install -r "$zb\scripts\requirements-base.txt" } "pip install zephyr requirements"
  # Build-relevant per-module Python requirements ONLY (not docs/test/harness).
  # HAL scripts/zephyr dirs (esptool for espressif, vendor tools) + top-level lib
  # codegen (nanopb, zcbor). Board support is universal (west fetched every
  # module, SDK ships every cross-toolchain); these are the few build extras.
  Write-Host "init-workspace: installing per-module Python requirements (build tooling only)..."
  $patterns = @(
    (Join-Path $env:WORKSPACE_DIR 'modules/hal/*/scripts/requirements.txt'),
    (Join-Path $env:WORKSPACE_DIR 'modules/hal/*/zephyr/requirements.txt'),
    (Join-Path $env:WORKSPACE_DIR 'modules/lib/*/requirements.txt'),
    (Join-Path $env:WORKSPACE_DIR 'modules/lib/*/scripts/requirements.txt')
  )
  foreach ($pat in $patterns) {
    foreach ($req in Get-Item -Path $pat -ErrorAction SilentlyContinue) {
      & $MambaExe run -n $ENV_NAME pip install -r $req.FullName 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { Write-Warning "init-workspace:   module requirements failed: $($req.FullName)" }
    }
  }
  Write-Host "init-workspace: done - ZEPHYR_BASE=$zb"
} else {
  Write-Host "install: -NoWorkspace - skipping west init/update"
}

# --- done -------------------------------------------------------------------
Write-Host ""
Write-Host "install: done."
Write-Host "The micromamba shell hook has been added to your PowerShell profile."
Write-Host "Open a NEW PowerShell window (or reload it with '. `$PROFILE'), then:"
Write-Host "  micromamba activate $ENV_NAME"
Write-Host ""
Write-Host "Verify:"
Write-Host "  west --version"
Write-Host "  echo `$env:ZEPHYR_BASE  # -> $zb"
Write-Host ""
Write-Host "For the CURRENT session without a new window, run this (robust hook-load):"
Write-Host "  Invoke-Expression ((& '$MambaExe' shell hook -s powershell) -join [char]10)"
Write-Host "  micromamba activate $ENV_NAME"
