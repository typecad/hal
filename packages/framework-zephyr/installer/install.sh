#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# typeCAD Zephyr installer — POSIX bootstrap (Linux, macOS, Git Bash on Windows).
#
# One-command install of a working Zephyr build environment via micromamba:
#   1. download the micromamba static binary (no preinstalled conda/Python needed)
#   2. create a conda env with the host build tools (west, cmake, ninja, dtc, ...)
#   3. install activation hooks that set ZEPHYR_BASE + ZEPHYR_SDK_INSTALL_DIR
#   4. fetch + extract the official Zephyr SDK full bundle (cross-toolchains)
#   5. west init + west update a vanilla Zephyr workspace
#
# After install: `micromamba activate zephyr` and framework-zephyr's west
# discovery cascade (packages/framework-zephyr/src/toolchain/west-discover.ts)
# picks up west via PATH + ZEPHYR_BASE automatically — no manual env vars.
#
# Usage:
#   bash install.sh [--dry-run] [--no-sdk] [--no-workspace]
#                   [--env-name NAME] [--sdk-version VER] [--help]
#
# --dry-run       print the resolved plan (URLs, paths, versions) and exit;
#                 downloads/creates nothing. Used by the test suite.
# --no-sdk        skip the Zephyr SDK download (env + workspace only).
# --no-workspace  skip west init/update (env + SDK only).
# --env-name      override the conda env name (default: zephyr).
# --sdk-version   override the Zephyr SDK version (default: pinned in versions.env).
# ---------------------------------------------------------------------------
set -eu

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- flag parsing -----------------------------------------------------------
DRY_RUN=0
DO_SDK=1
DO_WORKSPACE=1
ENV_NAME_OVERRIDE=""
SDK_VERSION_OVERRIDE=""
PLATFORMS=""

usage() {
  cat <<'EOF'
Usage: bash install.sh [options]

  --dry-run        Print the resolved plan (URLs, paths, versions) and exit.
                   Downloads/creates nothing.
  --no-sdk         Skip the Zephyr SDK download (env + workspace only).
  --no-workspace   Skip west init/update (env + SDK only).
  --modify         SDK platforms only: re-run selection and ADD the selected
                   platforms with missing toolchains. Implies --no-workspace.
  --prune          With --modify: also DELETE toolchains of platforms not in
                   the selection (reclaim disk space). Without it, --modify
                   is purely additive.
  --platforms SEL  Comma-separated platform groups (arm,esp32,riscv,arc,rx,x86,aarch64)
                   or 'all' for the full bundle. Default: all — RECOMMENDED:
                   every board in the data pack builds as-is.
  --env-name NAME  Override the conda env name (default: zephyr).
  --sdk-version V  Override the Zephyr SDK version (default: pinned in versions.env).
  -h, --help       Show this help.

Environment overrides:
  MAMBA_ROOT_PREFIX  micromamba root (default: ~/micromamba)
  WORKSPACE_DIR      west workspace (default: ~/zephyrproject)
  SDK_INSTALL_PARENT where the SDK extracts (default: inside the conda env)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)        DRY_RUN=1 ;;
    --no-sdk)         DO_SDK=0 ;;
    --no-workspace)   DO_WORKSPACE=0 ;;
    --modify|-m)      DO_WORKSPACE=0 ;;
    --prune)          PRUNE=1 ;;
    --platforms)      PLATFORMS="${2:?--platforms needs a value}"; shift ;;
    --env-name)       ENV_NAME_OVERRIDE="${2:?--env-name needs a value}"; shift ;;
    --sdk-version)    SDK_VERSION_OVERRIDE="${2:?--sdk-version needs a value}"; shift ;;
    -h|--help)        usage; exit 0 ;;
    *) echo "install: unknown flag: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

: "${PLATFORMS:=all}"
export PRUNE="${PRUNE:-0}"

# --- load pinned versions + library functions -------------------------------
# shellcheck source=versions.env
. "$PKG_DIR/versions.env"
# shellcheck source=lib/detect-platform.sh
. "$PKG_DIR/lib/detect-platform.sh"
# shellcheck source=lib/fetch-sdk.sh
. "$PKG_DIR/lib/fetch-sdk.sh"
# shellcheck source=lib/init-workspace.sh
. "$PKG_DIR/lib/init-workspace.sh"
# shellcheck source=lib/write-activation.sh
. "$PKG_DIR/lib/write-activation.sh"

# Apply CLI overrides.
[ -n "$ENV_NAME_OVERRIDE" ] && ENV_NAME="$ENV_NAME_OVERRIDE"
[ -n "$SDK_VERSION_OVERRIDE" ] && ZEPHYR_SDK_VERSION="$SDK_VERSION_OVERRIDE"

# --- platform detection -----------------------------------------------------
detect_platform

# --- path resolution --------------------------------------------------------
: "${MAMBA_ROOT_PREFIX:=$HOME/micromamba}"
: "${WORKSPACE_DIR:=$HOME/zephyrproject}"
ENV_PREFIX="$MAMBA_ROOT_PREFIX/envs/$ENV_NAME"
# SDK lives OUTSIDE the env prefix: `micromamba create` requires the prefix
# empty, and a failed create must not trap a multi-GB SDK download.
: "${SDK_INSTALL_PARENT:=$MAMBA_ROOT_PREFIX/zephyr-sdk}"
ZEPHYR_SDK_INSTALL_DIR="$SDK_INSTALL_PARENT/zephyr-sdk-$ZEPHYR_SDK_VERSION"

# micromamba binary lives at different paths on POSIX vs Windows (the win-64
# tarball ships Library/bin/micromamba.exe, not bin/micromamba).
case "$MAMBA_PLAT" in
  win-*) : "${MAMBA:=$MAMBA_ROOT_PREFIX/Library/bin/micromamba.exe}" ;;
  *)     : "${MAMBA:=$MAMBA_ROOT_PREFIX/bin/micromamba}" ;;
esac

# --- plan printer (greppable: every line tagged [plan]) ---------------------
print_plan() {
  local bundle="zephyr-sdk-${ZEPHYR_SDK_VERSION}_${SDK_PLAT}${ZEPHYR_SDK_BUNDLE_SUFFIX}.${ARCHIVE_EXT}"
  echo "[plan] typeCAD Zephyr installer"
  echo "[plan]   env name:          $ENV_NAME"
  echo "[plan]   conda subdir:      $MAMBA_PLAT"
  echo "[plan]   sdk platform:      $SDK_PLAT"
  echo "[plan]   sdk version:       $ZEPHYR_SDK_VERSION"
  echo "[plan]   platforms:         $PLATFORMS"
  echo "[plan]   sdk bundle:        $bundle"
  echo "[plan]   sdk bundle url:    $SDK_RELEASE_BASE/v$ZEPHYR_SDK_VERSION/$bundle"
  echo "[plan]   micromamba url:    $MICROMAMBA_BASE/$MAMBA_PLAT/latest"
  echo "[plan]   micromamba bin:    $MAMBA"
  echo "[plan]   env prefix:        $ENV_PREFIX"
  echo "[plan]   sdk install dir:   $ZEPHYR_SDK_INSTALL_DIR"
  echo "[plan]   workspace dir:     $WORKSPACE_DIR"
  echo "[plan]   zephyr base:       $WORKSPACE_DIR/zephyr"
  echo "[plan]   manifest url:      $ZEPHYR_MANIFEST_URL"
  echo "[plan]   manifest rev:      $ZEPHYR_MANIFEST_REV"
  echo "[plan]   do sdk:            $DO_SDK"
  echo "[plan]   do workspace:      $DO_WORKSPACE"
}

print_plan

if [ "$DRY_RUN" = "1" ]; then
  echo "[plan] DRY-RUN — no downloads, no env created."
  exit 0
fi

# --- 1. micromamba ----------------------------------------------------------
download_micromamba() {
  if [ -x "$MAMBA" ]; then
    echo "micromamba: already present at $MAMBA"
    return 0
  fi
  echo "micromamba: downloading ($MAMBA_PLAT)..."
  mkdir -p "$MAMBA_ROOT_PREFIX"
  curl -Ls "$MICROMAMBA_BASE/$MAMBA_PLAT/latest" | tar -xvj -C "$MAMBA_ROOT_PREFIX"
  if [ ! -x "$MAMBA" ]; then
    # Windows tarballs may land at a different inner path; locate it as a fallback.
    local found
    found="$(find "$MAMBA_ROOT_PREFIX" -name 'micromamba*' -type f 2>/dev/null | head -1 || true)"
    [ -n "$found" ] && MAMBA="$found"
  fi
  if [ ! -x "$MAMBA" ]; then
    echo "micromamba: download failed — binary not found under $MAMBA_ROOT_PREFIX" >&2
    return 1
  fi
  echo "micromamba: installed at $MAMBA"
}

download_micromamba
export MAMBA_ROOT_PREFIX

# Register the micromamba shell hook in ~/.bashrc so `micromamba` is on PATH
# and `micromamba activate <env>` works in new bash shells. micromamba lands
# under $MAMBA_ROOT_PREFIX/bin, which is not on PATH by default.
echo "micromamba: registering shell hook in ~/.bashrc..."
"$MAMBA" shell init -s bash -r "$MAMBA_ROOT_PREFIX" \
  || echo "micromamba: shell init (bash) failed — non-fatal; run it manually" >&2

# --- 2. conda env (host tools) ---------------------------------------------
create_env() {
  if [ -d "$ENV_PREFIX" ] && "$MAMBA" env list 2>/dev/null | grep -q "^${ENV_NAME} "; then
    echo "env: '$ENV_NAME' already exists at $ENV_PREFIX — updating"
    "$MAMBA" env update -y -f "$PKG_DIR/environment.yml" -p "$ENV_PREFIX" || {
      echo "env: env update failed" >&2; return 1; }
  elif [ -e "$ENV_PREFIX" ]; then
    # Prefix dir exists but micromamba doesn't list it as an env (no conda-meta).
    # `create` would abort with "Non-conda folder exists at prefix". Surface it
    # rather than auto-deleting a dir that may hold a multi-GB SDK.
    echo "env: ERROR — '$ENV_PREFIX' exists but is not a valid conda env (no conda-meta)." >&2
    echo "env:   Usually left by a prior failed run. Remove it and re-run:" >&2
    echo "env:     rm -rf '$ENV_PREFIX'" >&2
    return 1
  else
    echo "env: creating '$ENV_NAME' from environment.yml..."
    "$MAMBA" create -y -f "$PKG_DIR/environment.yml" -n "$ENV_NAME" || {
      echo "env: env create failed" >&2; return 1; }
  fi
}

# Platform-limited host tools that can't live in environment.yml (micromamba
# ignores `# [not win]` selectors, so they'd break the solve on Windows).
#   dtc     — conda-forge has it for all POSIX subdirs. Needed for devicetree.
#   openocd — conda-forge has it ONLY for linux-64 / osx-64 (no arm64, no win).
# Both are optional for the env to exist; we warn on failure so the env stays
# usable rather than aborting the whole install over a flashing/debug helper.
install_platform_tools() {
  if [[ "$MAMBA_PLAT" == win-* ]]; then
    echo "env: Windows host via install.sh — skipping POSIX-only tools."
    echo "env:   (On Windows, use 'node install.mjs' / install.ps1, which installs 7zip instead.)"
    return 0
  fi
  echo "env: installing POSIX host tools (dtc, openocd)..."
  if ! "$MAMBA" install -y -n "$ENV_NAME" -c conda-forge dtc >/dev/null 2>&1; then
    echo "env: WARNING — dtc not installed on $MAMBA_PLAT." >&2
    echo "env:   Zephyr builds needing the C devicetree compiler will fail until dtc is available." >&2
  fi
  if ! "$MAMBA" install -y -n "$ENV_NAME" -c conda-forge openocd >/dev/null 2>&1; then
    echo "env: note — openocd not available on $MAMBA_PLAT (only x86_64 POSIX); skipped." >&2
    echo "env:   only needed for JTAG/SWD flashing; nRF boards use nrfjprog/pyocd." >&2
  fi
  # dfu-util — west flash's dfu-util runner (STM32 ROM DFU bootloader boards,
  # e.g. the WeAct Black Pill) shells out to it; a missing executable makes
  # the runner die with a raw FileNotFoundError. Not on conda-forge either, so
  # fall back to the system package manager. No auto-sudo: warn with the
  # right command instead of failing the install over a flashing helper.
  if ! command -v dfu-util >/dev/null 2>&1; then
    echo "env: dfu-util not found — west flash on DFU-bootloader boards (STM32) needs it." >&2
    case "$(uname -s)" in
      Linux)
        if command -v apt-get >/dev/null 2>&1; then
          echo "env:   install with: sudo apt-get install dfu-util" >&2
        elif command -v dnf >/dev/null 2>&1; then
          echo "env:   install with: sudo dnf install dfu-util" >&2
        elif command -v pacman >/dev/null 2>&1; then
          echo "env:   install with: sudo pacman -S dfu-util" >&2
        else
          echo "env:   install dfu-util via your distribution's package manager." >&2
        fi ;;
      Darwin)
        echo "env:   install with: brew install dfu-util" >&2 ;;
      *)
        echo "env:   install dfu-util via your package manager (https://dfu-util.sourceforge.net)." >&2 ;;
    esac
  fi
  # bossac — west flash's bossac runner (SAMD SAM-BA bootloader boards — the
  # Arduino Nano 33 IoT, Zero, MKR series) shells out to it, and Zephyr's
  # FindHostTools resolves find_program(BOSSAC) at build-configure time, so it
  # must be on PATH BEFORE building. In neither the Zephyr SDK nor conda-forge;
  # no auto-sudo — warn with the right command instead.
  if ! command -v bossac >/dev/null 2>&1; then
    echo "env: bossac not found — west flash on SAM-BA-bootloader boards (SAMD) needs it." >&2
    case "$(uname -s)" in
      Linux)
        if command -v apt-get >/dev/null 2>&1; then
          echo "env:   install with: sudo apt-get install bossa-cli" >&2
        else
          echo "env:   install bossac via your distribution's package manager, or build it: https://github.com/shumatech/BOSSA" >&2
        fi ;;
      Darwin)
        echo "env:   install with: brew install bossa" >&2 ;;
      *)
        echo "env:   install bossac via your package manager (https://github.com/shumatech/BOSSA)." >&2 ;;
    esac
  fi
}

create_env
install_platform_tools

# --- 3. activation hooks ---------------------------------------------------
write_activation

# --- 4. Zephyr SDK ---------------------------------------------------------
if [ "$DO_SDK" = "1" ]; then
  fetch_sdk
else
  echo "install: --no-sdk — skipping Zephyr SDK download"
fi

# --- 5. west workspace -----------------------------------------------------
if [ "$DO_WORKSPACE" = "1" ]; then
  init_workspace
else
  echo "install: --no-workspace — skipping west init/update"
fi

# --- done -------------------------------------------------------------------
cat <<EOF

install: done.

The micromamba shell hook has been added to ~/.bashrc.
Open a NEW shell (or run 'source ~/.bashrc'), then:
  micromamba activate $ENV_NAME

Verify:
  west --version
  echo \$ZEPHYR_BASE              # -> $WORKSPACE_DIR/zephyr

For the CURRENT session without a new shell:
  eval "\$("$MAMBA" shell hook --shell bash)"
  micromamba activate $ENV_NAME

Then a typeCAD/typecad-hal Zephyr build should discover west automatically:
  cd <project> && npx typecad-hal build

EOF
