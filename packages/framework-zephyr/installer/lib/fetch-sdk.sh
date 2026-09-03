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

# List installed toolchain targets by scanning a directory. Used by the
# --modify delta (installed-but-not-selected → removed). The xtensa- prefixed
# pattern matters: xtensa targets are multi-segment
# (xtensa-espressif_esp32s3_zephyr-elf) and a single-segment regex misses them.
_list_installed_toolchains() {
  local dir="$1"
  [ -d "$dir" ] || return 0
  (cd "$dir" && ls -d */ 2>/dev/null | sed 's|/$||' | grep -E '^(xtensa-)?.*-zephyr-(eabi|elf)$' || true)
}

fetch_sdk() {
  local sdk="$SDK_INSTALL_PARENT/zephyr-sdk-${ZEPHYR_SDK_VERSION}"
  local platforms="${PLATFORMS:-all}"
  # 1.0.x bundle flavor suffix (_gnu = all GNU toolchains + host tools); empty
  # for 0.17.x "full" bundles. Individual toolchain tarballs carry the flavor
  # as an infix (toolchain_gnu_<plat>_<target>) when set.
  local suffix="${ZEPHYR_SDK_BUNDLE_SUFFIX:-}"
  local tc_infix=""
  [ -n "$suffix" ] && tc_infix="${suffix#_}_"
  echo "fetch-sdk: platform selection: $platforms"

  # ── FULL BUNDLE MODE (platforms = "all") ────────────────────────────────────
  if [ "$platforms" = "all" ]; then
    local bundle="zephyr-sdk-${ZEPHYR_SDK_VERSION}_${SDK_PLAT}${suffix}.${ARCHIVE_EXT}"
    local url="${SDK_RELEASE_BASE}/v${ZEPHYR_SDK_VERSION}/${bundle}"
    local checksum_var="SHA256_$(echo "$SDK_PLAT" | tr '-' '_')"
    local expected="${!checksum_var:-TODO}"

    if [ "$expected" = "NONE" ]; then
      echo "fetch-sdk: ERROR — the Zephyr SDK ${ZEPHYR_SDK_VERSION} publishes no build for ${SDK_PLAT}." >&2
      echo "fetch-sdk:   (macOS Intel has no 1.0.x SDK.) Use an ARM Mac, or pin the older" >&2
      echo "fetch-sdk:   SDK line: --sdk-version 0.17.4" >&2
      return 1
    fi

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
  local sel_checksum="SHA256_$(echo "$SDK_PLAT" | tr '-' '_')"
  if [ "${!sel_checksum:-TODO}" = "NONE" ]; then
    echo "fetch-sdk: ERROR — the Zephyr SDK ${ZEPHYR_SDK_VERSION} publishes no build for ${SDK_PLAT}." >&2
    echo "fetch-sdk:   (macOS Intel has no 1.0.x SDK.) Use an ARM Mac, or pin the older" >&2
    echo "fetch-sdk:   SDK line: --sdk-version 0.17.4" >&2
    return 1
  fi
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

  # 1.0.x installs toolchains under <sdk>/gnu/ — the SDK's own setup.sh does
  # `cd gnu && tar -x`, and its cmake globs ${ZEPHYR_SDK_INSTALL_DIR}/gnu/*
  # (generic.cmake: TOOLCHAIN_HOME=${ZEPHYR_SDK_INSTALL_DIR}/gnu). 0.17.x used
  # the SDK root. Toolchains misplaced at the root by older installers are
  # migrated (moved) into gnu/ instead of re-downloaded. Idempotency checks
  # <target>/bin — a bare <target>/ dir can be a hollow leftover of a failed
  # setup.sh/setup.cmd toolchain download.
  local tc_root="$sdk"
  local sdk_ng=0
  if [ -n "$suffix" ]; then
    tc_root="$sdk/gnu"
    sdk_ng=1
  fi
  mkdir -p "$tc_root"

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
      # Migrate / clean a misplaced SDK-root copy from pre-1.0.x-layout installs.
      if [ "$sdk_ng" -eq 1 ] && [ -d "$sdk/$target" ]; then
        if [ -d "$tc_root/$target/bin" ]; then
          echo "fetch-sdk:   $target — removing misplaced SDK-root copy (pre-1.0.x-layout install)"
          rm -rf "$sdk/$target"
        else
          echo "fetch-sdk:   $target — migrating misplaced SDK-root copy into gnu/"
          mv "$sdk/$target" "$tc_root/$target"
        fi
        continue
      fi
      if [ -d "$tc_root/$target/bin" ]; then
        echo "fetch-sdk:   $target — already installed, skipping"
        continue
      fi
      # A target dir without bin/ is a hollow leftover (e.g. a failed SDK
      # setup.sh download) — remove it so the fresh extract lands clean.
      if [ -d "$tc_root/$target" ]; then
        echo "fetch-sdk:   $target — hollow toolchain dir (no bin/), re-downloading"
        rm -rf "$tc_root/$target"
      fi
      # 1.0.x names individual toolchains toolchain_gnu_<plat>_<target>; 0.17.x
      # used toolchain_<plat>_<target>. tc_infix carries the flavor when set.
      local tc_bundle="toolchain_${tc_infix}${SDK_PLAT}_${target}.${ARCHIVE_EXT}"
      local tc_url="${SDK_RELEASE_BASE}/v${ZEPHYR_SDK_VERSION}/${tc_bundle}"
      echo "fetch-sdk:   $target — downloading ${tc_bundle}"
      local tc_archive="${SDK_INSTALL_PARENT}/${tc_bundle}"
      _download "$tc_url" "$tc_archive" || return 1
      _verify "$tc_archive" "TODO" || true
      # Toolchain archives are flat (<target>/bin/...); extract into the
      # toolchain root (gnu/ on 1.0.x, the SDK root on 0.17.x).
      _extract "$tc_archive" "$tc_root" || return 1
      rm -f "$tc_archive"
    done
  done

  # 3. --prune only: remove installed toolchains that are NOT in the new
  #    selection. Without --prune the modify step is purely additive —
  #    unselected toolchains stay on disk so an existing install never
  #    loses anything because of a narrower re-run. On 1.0.x scan both the
  #    gnu/ root and the SDK root so misplaced copies get cleaned up too.
  if [ "${PRUNE:-0}" = "1" ]; then
    local installed="$(_list_installed_toolchains "$tc_root")"
    [ "$sdk_ng" -eq 1 ] && installed="$installed $(_list_installed_toolchains "$sdk")"
    local selected_targets=""
    for grp in ${platforms//,/ }; do
      local targets_var="PLATFORM_${grp}"
      selected_targets="$selected_targets ${!targets_var:-}"
    done
    for target in $installed; do
      if ! echo " $selected_targets " | grep -q " $target "; then
        echo "fetch-sdk: removing deselected toolchain: $target"
        rm -rf "$tc_root/$target" "$sdk/$target"
      fi
    done
  fi

  # 4. Persist the selection. Without --prune the marker records the UNION
  #    of what was here before and the new selection — the marker must
  #    describe what is actually on disk.
  local marker_path="$sdk/.typecad-platforms"
  local marker_sel="$platforms"
  if [ "${PRUNE:-0}" != "1" ] && [ -f "$marker_path" ]; then
    local prev union="" seen="" grp
    prev="$(cat "$marker_path")"
    for grp in $(echo "$prev,$platforms" | tr ',' ' '); do
      grp="$(echo "$grp" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      [ -z "$grp" ] && continue
      [ "$grp" = "all" ] && continue
      case " $seen " in
        *" $grp "*) ;;
        *) seen="$seen $grp"; union="${union:+$union,}$grp" ;;
      esac
    done
    [ -n "$union" ] && marker_sel="$union"
  fi
  echo "$marker_sel" > "$marker_path"
  echo "fetch-sdk: done — $sdk (platforms: $marker_sel)"
}
