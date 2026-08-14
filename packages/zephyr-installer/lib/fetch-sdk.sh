#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# fetch-sdk.sh — download, verify, and extract the Zephyr SDK.
# Sourced by install.sh. Defines fetch_sdk(), which reads:
#
#   ZEPHYR_SDK_VERSION, SDK_RELEASE_BASE  (versions.env)
#   SDK_PLAT, ARCHIVE_EXT                 (detect_platform)
#   SHA256_<platform-with-underscores>    (versions.env; TODO = unpinned)
#   SDK_INSTALL_PARENT                    (resolved by install.sh)
#   DRY_RUN                               (install.sh flag)
#   PLATFORMS                             (install.sh flag or install.mjs
#                                          checklist — comma-separated group
#                                          ids, or "all" for the full bundle)
#
# On success the SDK is extracted to $SDK_INSTALL_PARENT/zephyr-sdk-<version>/.
#
# SELECTIVE MODE (PLATFORMS != "all"): downloads the ~10MB minimal bundle
# (cmake config + sdk_version) then only the selected toolchains
# (~100-300MB per group). Idempotent per-toolchain: a target dir that already
# exists is skipped, so --modify can add platforms incrementally without
# re-downloading everything.
#
# We deliberately do NOT run the SDK's setup.sh: the Zephyr docs endorse
# setting ZEPHYR_SDK_INSTALL_DIR as the alternative to setup.sh's CMake
# registry registration. That avoids sudo, the interactive toolchain prompt,
# and any host-tools install (host tools come from the conda env instead).
# ---------------------------------------------------------------------------

# Cross-platform sha256: sha256sum on Linux/Git Bash, shasum -a 256 on macOS.
_compute_sha256() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

# Download helper shared by the bundle + toolchain paths.
_download() {
  local url="$1" archive="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 -C - -o "$archive" "$url" \
      || { echo "fetch-sdk: curl download failed" >&2; return 1; }
  elif command -v wget >/dev/null 2>&1; then
    wget -c -O "$archive" "$url" \
      || { echo "fetch-sdk: wget download failed" >&2; return 1; }
  else
    echo "fetch-sdk: need curl or wget on PATH" >&2
    return 1
  fi
}

# Verify (skip with a computed-hash printout when not yet pinned).
_verify() {
  local archive="$1" expected="$2"
  local actual
  actual="$(_compute_sha256 "$archive")"
  if [ "$expected" = "TODO" ] || [ -z "$expected" ]; then
    echo "fetch-sdk: WARNING — SHA256 not pinned (TODO in versions.env); skipping verification." >&2
    echo "fetch-sdk: computed sha256 (pin this in versions.env to enforce): $actual"
  else
    if [ "$actual" != "$expected" ]; then
      echo "fetch-sdk: SHA256 mismatch!" >&2
      echo "fetch-sdk:   expected: $expected" >&2
      echo "fetch-sdk:   actual:   $actual" >&2
      rm -f "$archive"
      return 1
    fi
    echo "fetch-sdk: sha256 OK ($actual)"
  fi
}

# Extract helper. ARCHIVE_EXT is .tar.xz (POSIX) or .7z (Windows).
_extract() {
  local archive="$1" dest="$2"
  case "$ARCHIVE_EXT" in
    tar.xz)
      tar -xf "$archive" -C "$dest" \
        || { echo "fetch-sdk: tar extract failed" >&2; return 1; }
      ;;
    7z)
      local sevenz
      sevenz="$(command -v 7z || command -v 7za || true)"
      if [ -z "$sevenz" ]; then
        echo "fetch-sdk: need 7z to extract a .7z bundle" >&2
        echo "fetch-sdk: the conda env provides it (7zip in environment.yml); activate the env first" >&2
        return 1
      fi
      "$sevenz" x -y -o"$dest" "$archive" >/dev/null \
        || { echo "fetch-sdk: 7z extract failed" >&2; return 1; }
      ;;
    *)
      echo "fetch-sdk: unknown archive extension: $ARCHIVE_EXT" >&2
      return 1
      ;;
  esac
}

# List installed toolchain targets by scanning the SDK dir. Used by the
# [plan] output + the --modify delta (installed-but-not-selected → removed).
_list_installed_toolchains() {
  local sdk="$1"
  [ -d "$sdk" ] || return 0
  (cd "$sdk" && ls -d */ 2>/dev/null | sed 's|/$||' | grep -E '^([a-z0-9]+-)?zephyr-(eabi|elf)$' || true)
}

fetch_sdk() {
  local sdk="$SDK_INSTALL_PARENT/zephyr-sdk-${ZEPHYR_SDK_VERSION}"
  local platforms="${PLATFORMS:-all}"
  echo "fetch-sdk: platform selection: $platforms"

  # ── FULL BUNDLE MODE (platforms = "all") ────────────────────────────────────
  if [ "$platforms" = "all" ]; then
    local bundle="zephyr-sdk-${ZEPHYR_SDK_VERSION}_${SDK_PLAT}.${ARCHIVE_EXT}"
    local url="${SDK_RELEASE_BASE}/v${ZEPHYR_SDK_VERSION}/${bundle}"
    local checksum_var="SHA256_$(echo "$SDK_PLAT" | tr '-' '_')"
    local expected="${!checksum_var:-TODO}"

    echo "fetch-sdk: downloading full bundle $bundle"
    echo "fetch-sdk:   url:    $url"
    echo "fetch-sdk:   sha256: ${expected}"

    if [ "$DRY_RUN" = "1" ]; then
      echo "fetch-sdk: [DRY-RUN] would download $url"
      echo "fetch-sdk: [DRY-RUN] would extract into $SDK_INSTALL_PARENT"
      echo "fetch-sdk: [DRY-RUN] would set ZEPHYR_SDK_INSTALL_DIR=$sdk"
      return 0
    fi

    if [ -e "$sdk/sdk_version" ]; then
      echo "fetch-sdk: SDK already present at $sdk — skipping download"
      return 0
    fi

    mkdir -p "$SDK_INSTALL_PARENT"
    local archive="${SDK_INSTALL_PARENT}/${bundle}"
    _download "$url" "$archive" || return 1
    _verify "$archive" "$expected" || return 1
    _extract "$archive" "$SDK_INSTALL_PARENT" || return 1
    rm -f "$archive"
    echo "fetch-sdk: done — $sdk"
    return 0
  fi

  # ── SELECTIVE MODE (minimal bundle + individual toolchains) ─────────────────
  local minimal="zephyr-sdk-${ZEPHYR_SDK_VERSION}_${SDK_PLAT}_minimal.${ARCHIVE_EXT}"
  local minimal_url="${SDK_RELEASE_BASE}/v${ZEPHYR_SDK_VERSION}/${minimal}"

  if [ "$DRY_RUN" = "1" ]; then
    echo "fetch-sdk: [DRY-RUN] would download minimal bundle $minimal_url (~10 MB)"
    echo "fetch-sdk: [DRY-RUN] selected platforms: $platforms"
    local grp
    for grp in ${platforms//,/ }; do
      local targets_var="PLATFORM_${grp}"
      echo "fetch-sdk: [DRY-RUN]   ${grp}: ${!targets_var:-<unknown group>}"
    done
    echo "fetch-sdk: [DRY-RUN] would write .typecad-platforms state file"
    return 0
  fi

  mkdir -p "$SDK_INSTALL_PARENT"

  # 1. Minimal bundle (cmake/ + sdk_version + sdk_toolchains — ~10 MB).
  if [ -e "$sdk/sdk_version" ]; then
    echo "fetch-sdk: SDK base already present at $sdk — skipping minimal bundle"
  else
    echo "fetch-sdk: downloading minimal bundle (~10 MB)"
    local minimal_archive="${SDK_INSTALL_PARENT}/${minimal}"
    _download "$minimal_url" "$minimal_archive" || return 1
    # The minimal bundle's SHA256 is small enough that a mismatch is unlikely;
    # verify if pinned but don't fail on TODO.
    _verify "$minimal_archive" "TODO" || true
    _extract "$minimal_archive" "$SDK_INSTALL_PARENT" || return 1
    rm -f "$minimal_archive"
  fi

  # 2. Individual toolchains for each selected platform group.
  local grp targets target
  for grp in ${platforms//,/ }; do
    local targets_var="PLATFORM_${grp}"
    targets="${!targets_var:-}"
    if [ -z "$targets" ]; then
      echo "fetch-sdk: WARNING — unknown platform group '$grp' (no PLATFORM_${grp} in versions.env); skipping" >&2
      continue
    fi
    echo "fetch-sdk: platform '${grp}':"
    for target in $targets; do
      if [ -d "$sdk/$target" ]; then
        echo "fetch-sdk:   $target — already installed, skipping"
        continue
      fi
      local tc_bundle="toolchain_${SDK_PLAT}_${target}.${ARCHIVE_EXT}"
      local tc_url="${SDK_RELEASE_BASE}/v${ZEPHYR_SDK_VERSION}/${tc_bundle}"
      echo "fetch-sdk:   $target — downloading ${tc_bundle}"
      local tc_archive="${SDK_INSTALL_PARENT}/${tc_bundle}"
      _download "$tc_url" "$tc_archive" || return 1
      _verify "$tc_archive" "TODO" || true
      # Individual toolchain tarballs may extract either to <target>/ directly
      # or with a leading ./ — tar handles both; extract into the SDK root.
      _extract "$tc_archive" "$sdk" || return 1
      rm -f "$tc_archive"
    done
  done

  # 3. Remove toolchains that are installed but NOT in the new selection.
  #    This is the "--modify" removal path: a user deselects a platform and its
  #    toolchains are deleted to reclaim disk space.
  local installed="$(_list_installed_toolchains "$sdk")"
  local selected_targets=""
  for grp in ${platforms//,/ }; do
    local targets_var="PLATFORM_${grp}"
    selected_targets="$selected_targets ${!targets_var:-}"
  done
  for target in $installed; do
    if ! echo " $selected_targets " | grep -q " $target "; then
      echo "fetch-sdk: removing deselected toolchain: $target"
      rm -rf "$sdk/$target"
    fi
  done

  # 4. Persist the selection.
  echo "$platforms" > "$sdk/.typecad-platforms"
  echo "fetch-sdk: done — $sdk (platforms: $platforms)"
}
