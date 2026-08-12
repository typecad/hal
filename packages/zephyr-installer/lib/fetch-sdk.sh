#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# fetch-sdk.sh — download, verify, and extract the Zephyr SDK full bundle.
# Sourced by install.sh. Defines fetch_sdk(), which reads:
#
#   ZEPHYR_SDK_VERSION, SDK_RELEASE_BASE  (versions.env)
#   SDK_PLAT, ARCHIVE_EXT                 (detect_platform)
#   SHA256_<platform-with-underscores>    (versions.env; TODO = unpinned)
#   SDK_INSTALL_PARENT                    (resolved by install.sh)
#   DRY_RUN                               (install.sh flag)
#
# On success the bundle is extracted to $SDK_INSTALL_PARENT/zephyr-sdk-<version>/.
# We deliberately do NOT run the SDK's setup.sh: the full bundle already
# contains the cross-toolchains pre-extracted, and the Zephyr docs endorse
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

fetch_sdk() {
  local bundle="zephyr-sdk-${ZEPHYR_SDK_VERSION}_${SDK_PLAT}.${ARCHIVE_EXT}"
  local url="${SDK_RELEASE_BASE}/v${ZEPHYR_SDK_VERSION}/${bundle}"
  local checksum_var="SHA256_$(echo "$SDK_PLAT" | tr '-' '_')"
  local expected="${!checksum_var:-TODO}"

  echo "fetch-sdk: downloading $bundle"
  echo "fetch-sdk:   url:    $url"
  echo "fetch-sdk:   sha256: ${expected}"

  if [ "$DRY_RUN" = "1" ]; then
    echo "fetch-sdk: [DRY-RUN] would download $url"
    echo "fetch-sdk: [DRY-RUN] would extract into $SDK_INSTALL_PARENT"
    echo "fetch-sdk: [DRY-RUN] would set ZEPHYR_SDK_INSTALL_DIR=$SDK_INSTALL_PARENT/zephyr-sdk-${ZEPHYR_SDK_VERSION}"
    return 0
  fi

  # Idempotent: the SDK full bundle ships a top-level `sdk_version` file once
  # extracted. Its presence means the SDK is already in place, so a re-run skips
  # a multi-GB re-download.
  if [ -e "$ZEPHYR_SDK_INSTALL_DIR/sdk_version" ]; then
    echo "fetch-sdk: already present at $ZEPHYR_SDK_INSTALL_DIR — skipping download"
    return 0
  fi

  mkdir -p "$SDK_INSTALL_PARENT"
  local archive="${SDK_INSTALL_PARENT}/${bundle}"

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

  # Verify (skip with a computed-hash printout when not yet pinned).
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

  # Extract. The bundle's top level is zephyr-sdk-<version>/.
  echo "fetch-sdk: extracting into $SDK_INSTALL_PARENT"
  case "$ARCHIVE_EXT" in
    tar.xz)
      tar -xf "$archive" -C "$SDK_INSTALL_PARENT" \
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
      "$sevenz" x -y -o"$SDK_INSTALL_PARENT" "$archive" >/dev/null \
        || { echo "fetch-sdk: 7z extract failed" >&2; return 1; }
      ;;
    *)
      echo "fetch-sdk: unknown archive extension: $ARCHIVE_EXT" >&2
      return 1
      ;;
  esac

  rm -f "$archive"
  echo "fetch-sdk: done — $SDK_INSTALL_PARENT/zephyr-sdk-${ZEPHYR_SDK_VERSION}"
}
