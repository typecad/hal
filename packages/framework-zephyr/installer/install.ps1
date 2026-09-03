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
  [switch]$Prune,
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
# 1.0.x bundle flavor suffix (_gnu); empty for 0.17.x "full" bundles. Individual
# toolchain tarballs carry the flavor as an infix (toolchain_gnu_<plat>_<target>).
$SdkSuffix = if ($ZEPHYR_SDK_BUNDLE_SUFFIX) { $ZEPHYR_SDK_BUNDLE_SUFFIX } else { '' }
$TcInfix = if ($SdkSuffix) { $SdkSuffix.TrimStart('_') + '_' } else { '' }
$bundle = "zephyr-sdk-$ZEPHYR_SDK_VERSION`_$SdkPlat$SdkSuffix.$ArchiveExt"
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

# dfu-util: west flash's dfu-util runner (STM32 ROM DFU bootloader boards,
# e.g. the WeAct Black Pill) shells out to dfu-util, and the runner dies with
# a raw FileNotFoundError when the executable is missing. conda-forge has no
# dfu-util build, so fetch MSYS2's mingw64 dfu-util package plus the
# libusb / libwinpthread runtime DLLs it links, and unpack them into the
# env's Library\bin — that dir is on the activation PATH and on the PATH of
# the `micromamba run -n zephyr west flash` the framework toolchain spawns,
# so flashing works without a global dfu-util install. Idempotent: skipped
# when dfu-util.exe is already in place. Warn-and-continue on any failure
# (it only affects DFU-bootloader boards).
$dfuBinDir = Join-Path $EnvPrefix 'Library\bin'
if (Test-Path (Join-Path $dfuBinDir 'dfu-util.exe')) {
  Write-Host "dfu-util: already present - skipping"
} else {
  $dfu7z = Get-ChildItem -Path $EnvPrefix -Recurse -Filter '7z.exe' -ErrorAction SilentlyContinue `
           | Select-Object -First 1 -ExpandProperty FullName
  if (-not $dfu7z) { $found = Get-Command 7z -ErrorAction SilentlyContinue; if ($found) { $dfu7z = $found.Source } }
  if (-not $dfu7z) {
    Write-Warning "dfu-util: 7z.exe not found - skipping (west flash on DFU-bootloader boards will need dfu-util on PATH)."
  } else {
    try {
      New-Item -ItemType Directory -Force -Path $dfuBinDir | Out-Null
      $dfuTmp = Join-Path ([System.IO.Path]::GetTempPath()) "tc-dfu-util-$PID"
      New-Item -ItemType Directory -Force -Path $dfuTmp | Out-Null
      # Each package is a .zst wrapping a .tar; 7z handles both layers.
      $dfuPkgs = @(
        @{ Name = $DFU_UTIL_PKG;      Sha256 = $DFU_UTIL_PKG_SHA256 },
        @{ Name = $LIBUSB_PKG;        Sha256 = $LIBUSB_PKG_SHA256 },
        @{ Name = $LIBWINPTHREAD_PKG; Sha256 = $LIBWINPTHREAD_PKG_SHA256 }
      )
      foreach ($pkg in $dfuPkgs) {
        $zst = Join-Path $dfuTmp "$($pkg.Name)-any.pkg.tar.zst"
        Download-File -Url "$MSYS2_MINGW64_BASE/$($pkg.Name)-any.pkg.tar.zst" -OutFile $zst
        $actual = (Get-FileHash $zst -Algorithm SHA256).Hash.ToLower()
        if ($pkg.Sha256 -and $pkg.Sha256 -ne 'TODO' -and $actual -ne $pkg.Sha256.ToLower()) {
          throw "SHA256 mismatch for $($pkg.Name) (expected $($pkg.Sha256), got $actual)"
        }
        Invoke-Native { & $dfu7z x -y "-o$dfuTmp" $zst } "dfu-util extract zst ($($pkg.Name))"
        $tar = Join-Path $dfuTmp "$($pkg.Name)-any.pkg.tar"
        Invoke-Native { & $dfu7z x -y "-o$(Join-Path $dfuTmp "x-$($pkg.Name)")" $tar } "dfu-util extract tar ($($pkg.Name))"
      }
      # Payload: the three dfu-* executables + the two runtime DLLs.
      foreach ($root in @(
        (Join-Path $dfuTmp "x-$DFU_UTIL_PKG\mingw64\bin"),
        (Join-Path $dfuTmp "x-$LIBUSB_PKG\mingw64\bin"),
        (Join-Path $dfuTmp "x-$LIBWINPTHREAD_PKG\mingw64\bin")
      )) {
        if (Test-Path $root) { Copy-Item (Join-Path $root '*') $dfuBinDir -Force }
      }
      Remove-Item -Recurse -Force $dfuTmp -ErrorAction SilentlyContinue
      Write-Host "dfu-util: installed - $(Join-Path $dfuBinDir 'dfu-util.exe')"
    } catch {
      Write-Warning "dfu-util: install failed ($_) - west flash on DFU-bootloader boards will need dfu-util on PATH."
    }
  }
}

# bossac: west flash's bossac runner (SAMD SAM-BA bootloader boards - the
# Arduino Nano 33 IoT, Zero, MKR series) shells out to bossac. Zephyr's
# FindHostTools resolves find_program(BOSSAC) at BUILD-CONFIGURE time, so a
# missing binary gets baked into the runner args (BOSSAC-NOTFOUND) and west
# flash dies with "required program bossac not found" even after bossac
# lands on PATH without a reconfigure. bossac is in neither the Zephyr SDK
# nor conda-forge; the official upstream MSI extracts cleanly with 7z and
# ships a self-contained bossac.exe (system DLLs only). Same placement rules
# as dfu-util above. Idempotent; warn-and-continue (SAM-BA boards only).
if (Test-Path (Join-Path $dfuBinDir 'bossac.exe')) {
  Write-Host "bossac: already present - skipping"
} else {
  $bossa7z = Get-ChildItem -Path $EnvPrefix -Recurse -Filter '7z.exe' -ErrorAction SilentlyContinue `
             | Select-Object -First 1 -ExpandProperty FullName
  if (-not $bossa7z) { $found = Get-Command 7z -ErrorAction SilentlyContinue; if ($found) { $bossa7z = $found.Source } }
  if (-not $bossa7z) {
    Write-Warning "bossac: 7z.exe not found - skipping (west flash on SAM-BA-bootloader boards will need bossac on PATH)."
  } else {
    try {
      $bossaTmp = Join-Path ([System.IO.Path]::GetTempPath()) "tc-bossa-$PID"
      New-Item -ItemType Directory -Force -Path $bossaTmp | Out-Null
      $msi = Join-Path $bossaTmp 'bossa-x64.msi'
      Download-File -Url $BOSSA_URL -OutFile $msi
      $actual = (Get-FileHash $msi -Algorithm SHA256).Hash.ToLower()
      if ($BOSSA_SHA256 -and $actual -ne $BOSSA_SHA256.ToLower()) {
        throw "SHA256 mismatch for bossac MSI (expected $BOSSA_SHA256, got $actual)"
      }
      Invoke-Native { & $bossa7z x -y "-o$bossaTmp" $msi } "bossac extract msi"
      if (-not (Test-Path (Join-Path $bossaTmp 'bossac.exe'))) { throw "bossac.exe not found in MSI payload" }
      Copy-Item (Join-Path $bossaTmp 'bossac.exe') $dfuBinDir -Force
      Remove-Item -Recurse -Force $bossaTmp -ErrorAction SilentlyContinue
      Write-Host "bossac: installed - $(Join-Path $dfuBinDir 'bossac.exe')"
    } catch {
      Write-Warning "bossac: install failed ($_) - west flash on SAM-BA-bootloader boards will need bossac on PATH."
    }
  }
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

      # 1.0.x installs toolchains under <sdk>\gnu\ - the SDK's own setup.cmd
      # does `pushd gnu; 7z x`, and its cmake globs
      # ${ZEPHYR_SDK_INSTALL_DIR}/gnu/*. 0.17.x used the SDK root. Toolchains
      # misplaced at the root by older installers are migrated (moved) into
      # gnu\ instead of re-downloaded. Idempotency checks <target>\bin - a
      # bare <target>\ dir can be a hollow leftover of a failed setup.cmd
      # toolchain download.
      $tcRoot = if ($TcInfix) { Join-Path $ZephyrSdkInstallDir 'gnu' } else { $ZephyrSdkInstallDir }
      New-Item -ItemType Directory -Force -Path $tcRoot | Out-Null

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
          $misplaced = if ($TcInfix) { Join-Path $ZephyrSdkInstallDir $target } else { $null }
          # Migrate / clean a misplaced SDK-root copy from pre-1.0.x-layout installs.
          if ($misplaced -and (Test-Path $misplaced)) {
            if (Test-Path (Join-Path $tcRoot "$target\bin")) {
              Write-Host "fetch-sdk:   $target - removing misplaced SDK-root copy (pre-1.0.x-layout install)"
              Remove-Item -Recurse -Force $misplaced
            } else {
              Write-Host "fetch-sdk:   $target - migrating misplaced SDK-root copy into gnu\"
              Move-Item $misplaced (Join-Path $tcRoot $target)
            }
            continue
          }
          if (Test-Path (Join-Path $tcRoot "$target\bin")) {
            Write-Host "fetch-sdk:   $target - already installed, skipping"
            continue
          }
          # A target dir without bin\ is a hollow leftover - re-download clean.
          if (Test-Path (Join-Path $tcRoot $target)) {
            Write-Host "fetch-sdk:   $target - hollow toolchain dir (no bin\), re-downloading"
            Remove-Item -Recurse -Force (Join-Path $tcRoot $target)
          }
          $tcBundle = "toolchain_$TcInfix$($SdkPlat)_$($target).$ArchiveExt"
          $tcUrl = "$SDK_RELEASE_BASE/v$ZEPHYR_SDK_VERSION/$tcBundle"
          Write-Host "fetch-sdk:   $target - downloading $tcBundle"
          $tcArchive = Join-Path $env:SDK_INSTALL_PARENT $tcBundle
          Download-File -Url $tcUrl -OutFile $tcArchive
          if (-not $sevenz) { throw "fetch-sdk: 7z.exe not found in env or on PATH" }
          Invoke-Native { & $sevenz x -y "-o$tcRoot" $tcArchive } "fetch-sdk $target extract"
          Remove-Item $tcArchive -Force
        }
      }

            # 3. -Prune only: remove toolchains installed but NOT in the new
      #    selection. Without -Prune the modify step is purely additive —
      #    unselected toolchains stay on disk so an existing install never
      #    loses anything because of a narrower re-run. On 1.0.x scan both
      #    the gnu root and the SDK root so misplaced copies get cleaned up.
      if ($Prune) {
        $selectedTargets = @()
        foreach ($grp in $sel.Split(',')) {
          $t = (Get-Variable -Name "PLATFORM_$grp" -ErrorAction SilentlyContinue).Value
          if ($t) { $selectedTargets += $t.Split(' ') }
        }
        $scanDirs = @($tcRoot)
        if ($TcInfix) { $scanDirs += $ZephyrSdkInstallDir }
        Get-ChildItem -Path $scanDirs -Directory -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -match '^(xtensa-)?.*-zephyr-(eabi|elf)$' } |
          ForEach-Object {
            if ($selectedTargets -notcontains $_.Name) {
              Write-Host "fetch-sdk: removing deselected toolchain: $($_.Name)"
              Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue
            }
          }
      }

      # 4. Persist the selection. Without -Prune the marker records the UNION
      #    of what was here before and the new selection — the marker must
      #    describe what is actually on disk, and a narrower re-run must not
      #    make previously installed groups vanish from the record.
      $markerPath = Join-Path $ZephyrSdkInstallDir '.typecad-platforms'
      $markerSel = $sel
      if (-not $Prune -and (Test-Path $markerPath)) {
        $prev = (Get-Content $markerPath -Raw).Trim()
        if ($prev) {
          $union = @()
          foreach ($grp in ($prev.Split(',') + $sel.Split(','))) {
            $g = $grp.Trim()
            if ($g -and ($g -ne 'all') -and ($union -notcontains $g)) { $union += $g }
          }
          $markerSel = $union -join ','
        }
      }
      Set-Content -Path $markerPath -Value $markerSel
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
    # A workspace adopted from a pre-existing install (or initialized by an
    # older installer) can track a branch or an older tag - plain `west update`
    # never moves the manifest repository, so it drifts out of sync with the
    # SDK this installer pins. Re-pin the revision AND check the tag out so
    # west update below syncs modules against the pinned manifest.
    Push-Location $env:WORKSPACE_DIR
    try {
      $curRev = (& $MambaExe run -n $ENV_NAME west config manifest.revision)
      if ($LASTEXITCODE -ne 0) { $curRev = '' }
      if ("$curRev".Trim() -ne $ZEPHYR_MANIFEST_REV) {
        $was = if ("$curRev".Trim()) { "$curRev" } else { '<unset - default branch>' }
        Write-Host "init-workspace: pinning manifest revision -> $ZEPHYR_MANIFEST_REV (was: $was)"
      }
      # All three steps are idempotent; they must also run when the config
      # already says the right thing but the tree is still on the old revision.
      Invoke-Native { & $MambaExe run -n $ENV_NAME west config manifest.revision $ZEPHYR_MANIFEST_REV } "west config manifest.revision"
      Invoke-Native { & $MambaExe run -n $ENV_NAME git -C $zb fetch origin "refs/tags/${ZEPHYR_MANIFEST_REV}:refs/tags/${ZEPHYR_MANIFEST_REV}" } "git fetch tag $ZEPHYR_MANIFEST_REV"
      Invoke-Native { & $MambaExe run -n $ENV_NAME git -C $zb checkout $ZEPHYR_MANIFEST_REV } "git checkout $ZEPHYR_MANIFEST_REV"
    } finally { Pop-Location }
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
  # Workspace patches — upstream fixes the pinned manifest revisions don't
  # carry yet. Applied with `git apply --check` first so an already-applied
  # (or already-upstreamed) patch is skipped, never a hard failure. Each
  # patch carries a `# typecad-repo: <workspace-relative path>` header naming
  # the repo it patches (first-directory guesses break on nested projects).
  $patchesDir = Join-Path $PSScriptRoot 'patches'
  if (Test-Path $patchesDir) {
    foreach ($patch in Get-ChildItem -Path $patchesDir -Filter '*.patch' | Sort-Object Name) {
      $patchText = Get-Content $patch.FullName -Raw
      $repoName = if ($patchText -match '# typecad-repo:\s*(\S+)') { $Matches[1] } else { $null }
      if (-not $repoName) { Write-Warning "workspace-patch: $($patch.Name) - no 'typecad-repo:' header, skipping"; continue }
      $repoDir = Join-Path $env:WORKSPACE_DIR ($repoName -replace '/', '\')
      if (-not (Test-Path $repoDir)) { Write-Warning "workspace-patch: $($patch.Name) - $repoDir not present, skipping"; continue }
      Write-Host "init-workspace: applying patch $($patch.Name) to $repoName..."
      # `git apply --check` probes applicability WITHOUT touching stderr —
      # PS 5.1 wraps redirected native stderr in ErrorRecords (never redirect
      # native stderr through the pipeline), so the probe shells out via
      # Start-Process with a file redirect: exit 0 = applicable, else already
      # applied / inapplicable.
      $checkErr = Join-Path $env:TEMP "typecad-patch-check.$PID.err"
      $probe = Start-Process -FilePath 'git' `
        -ArgumentList @('-C', $repoDir, 'apply', '--check', $patch.FullName) `
        -NoNewWindow -Wait -PassThru -RedirectStandardError $checkErr
      if ($probe.ExitCode -ne 0) {
        Remove-Item $checkErr -Force -ErrorAction SilentlyContinue
        Write-Host "init-workspace:   already applied (or inapplicable) - skipping"
      } else {
        Remove-Item $checkErr -Force -ErrorAction SilentlyContinue
        Invoke-Native { & git -C $repoDir apply $patch.FullName } "workspace patch $($patch.Name)"
      }
    }
  }
  # Install Zephyr's pinned Python build deps (jsonschema, pykwalify, ...). CMake
  # checks for these and the build fails with "Missing jsonschema dependency"
  # without them; letting Zephyr's requirements file drive it tracks the revision.
  Write-Host "init-workspace: installing Zephyr Python requirements (requirements-base.txt)..."
  Invoke-Native { & $MambaExe run -n $ENV_NAME pip install -r "$zb\scripts\requirements-base.txt" } "pip install zephyr requirements"
  # imgtool — MCUboot's signing tool. Not in requirements-base.txt, but TF-M /
  # FVP signing steps invoke it as a module (mps4 corstone builds fail with
  # "No module named 'imgtool'" without it).
  Invoke-Native { & $MambaExe run -n $ENV_NAME pip install imgtool } "pip install imgtool"
  # TF-M secure-build tooling: the inner TF-M build's bl2_image_config step
  # parses compile_commands (needs the `clang` python bindings) and Nordic's
  # RTE_Device.h needs devicetree headers — requirements + libclang (native
  # library the python `clang` bindings load) from conda-forge.
  $tfmTools = Join-Path $env:WORKSPACE_DIR 'modules/tee/tf-m/trusted-firmware-m/tools/requirements.txt'
  if (Test-Path $tfmTools) {
    Invoke-Native { & $MambaExe run -n $ENV_NAME pip install -r $tfmTools } "pip install TF-M tools requirements"
  }
  Invoke-Native { & $MambaExe install -n $ENV_NAME -c conda-forge libclang -y } "micromamba install libclang"
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
      # Do NOT add a native stderr redirect on this call: under
      # $ErrorActionPreference='Stop', PowerShell 5.1 wraps redirected native
      # stderr in ErrorRecords and the first one becomes a TERMINATING error -
      # pip's live "Running command git clone ..." relay for git-pinned
      # packages (silabs' cmsis-svd) aborted the whole install this way.
      # Un-redirected native stderr just prints to the console.
      & $MambaExe run -n $ENV_NAME pip install -r $req.FullName
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
