#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# detect-platform.sh — map uname output to conda + Zephyr SDK platform tokens.
# Sourced by install.sh. Defines detect_platform(), which exports:
#
#   MAMBA_PLAT   conda subdir:  linux-64 | linux-aarch64 | osx-64 | osx-arm64 | win-64
#   SDK_PLAT     Zephyr SDK bundle platform: linux-x86_64 | linux-aarch64 |
#                macos-x86_64 | macos-aarch64 | windows-x86_64
#   ARCHIVE_EXT  archive type for the SDK bundle: tar.xz (POSIX) | 7z (Windows)
#
# Returns non-zero on unsupported platforms. The conda arch token is OS-
# dependent (x86_64 -> "64" everywhere; arm64 is "arm64" on macOS but
# "aarch64" on Linux), so it is built from an explicit case table rather
# than a string substitution.
# ---------------------------------------------------------------------------

detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  local mamba_os sdk_os
  case "$os" in
    Linux*)                       mamba_os=linux; sdk_os=linux   ;;
    Darwin*)                      mamba_os=osx;   sdk_os=macos   ;;
    MINGW*|MSYS*|CYGWIN*)         mamba_os=win;   sdk_os=windows ;;
    *)
      echo "detect-platform: unsupported OS: $os (expected Linux, macOS, or Windows/Git Bash)" >&2
      return 1
      ;;
  esac

  local sdk_arch
  case "$arch" in
    x86_64|amd64)   sdk_arch=x86_64 ;;
    aarch64|arm64)  sdk_arch=aarch64 ;;
    *)
      echo "detect-platform: unsupported arch: $arch (expected x86_64 or aarch64/arm64)" >&2
      return 1
      ;;
  esac

  case "${mamba_os}-${arch}" in
    linux-x86_64|osx-x86_64|win-x86_64) MAMBA_PLAT="${mamba_os}-64" ;;
    linux-aarch64|linux-arm64)          MAMBA_PLAT="linux-aarch64"  ;;
    osx-arm64)                          MAMBA_PLAT="osx-arm64"      ;;
    *)
      echo "detect-platform: no conda subdir maps to ${mamba_os}-${arch}" >&2
      return 1
      ;;
  esac

  SDK_PLAT="${sdk_os}-${sdk_arch}"

  if [ "$sdk_os" = "windows" ]; then
    ARCHIVE_EXT="7z"
  else
    ARCHIVE_EXT="tar.xz"
  fi

  export MAMBA_PLAT SDK_PLAT ARCHIVE_EXT
}
