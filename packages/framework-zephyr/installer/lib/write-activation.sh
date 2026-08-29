#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# write-activation.sh — install conda activation/deactivation hooks into the env.
# Sourced by install.sh. Defines write_activation(), which reads:
#
#   ENV_PREFIX                             (resolved by install.sh: env root)
#   WORKSPACE_DIR                          (resolved by install.sh)
#   ZEPHYR_SDK_INSTALL_DIR                 (resolved by install.sh)
#   PKG_DIR                                (install.sh: this package's root)
#   ZEPHYR_SDK_VERSION                     (versions.env)
#   DRY_RUN                                (install.sh flag)
#
# Writes three env-vars files (sh / bat / ps1) carrying the RESOLVED paths,
# then copies the static hooks from etc/conda/ into the env prefix. The hooks
# are shell-agnostic boilerplate that only source env-vars.* and export
# ZEPHYR_BASE + ZEPHYR_SDK_INSTALL_DIR — the per-machine values live in one
# editable file per shell, so re-pointing the SDK never touches hook logic.
#
# Why this makes framework-zephyr work with zero code changes: when the env is
# activated, west (from the conda env) is on PATH and ZEPHYR_BASE is exported,
# so west-discover.ts's discoverFromPath() (Strategy 1) wins immediately and
# returns the correct zephyrBase.
# ---------------------------------------------------------------------------

write_activation() {
  local act_dst="$ENV_PREFIX/etc/conda/activate.d"
  local deact_dst="$ENV_PREFIX/etc/conda/deactivate.d"
  local zb="$WORKSPACE_DIR/zephyr"

  echo "write-activation: hooks -> $act_dst / $deact_dst"

  if [ "$DRY_RUN" = "1" ]; then
    echo "write-activation: [DRY-RUN] would write env-vars.{sh,bat,ps1} to $ENV_PREFIX/etc/conda/"
    echo "write-activation: [DRY-RUN] would copy activate.d/zephyr.{sh,bat,ps1} + deactivate.d/zephyr.{sh,bat,ps1}"
    echo "write-activation: [DRY-RUN] ZEPHYR_BASE=$zb  ZEPHYR_SDK_INSTALL_DIR=$ZEPHYR_SDK_INSTALL_DIR"
    return 0
  fi

  mkdir -p "$act_dst" "$deact_dst"

  # POSIX (bash/zsh) — sourced by activate.d/zephyr.sh
  cat > "$ENV_PREFIX/etc/conda/env-vars.sh" <<EOF
# Resolved by the typeCAD Zephyr installer. Sourced by etc/conda/activate.d/zephyr.sh.
# Edit these two paths to re-point the workspace or SDK without touching the hooks.
export TYPECAD_ZEPHYR_BASE="$zb"
export TYPECAD_ZEPHYR_SDK_INSTALL_DIR="$ZEPHYR_SDK_INSTALL_DIR"
EOF

  # cmd.exe — called by activate.d/zephyr.bat
  cat > "$ENV_PREFIX/etc/conda/env-vars.bat" <<EOF
@echo off
REM Resolved by the typeCAD Zephyr installer. Called by etc/conda/activate.d/zephyr.bat.
set "TYPECAD_ZEPHYR_BASE=$zb"
set "TYPECAD_ZEPHYR_SDK_INSTALL_DIR=$ZEPHYR_SDK_INSTALL_DIR"
EOF

  # PowerShell — dot-sourced by activate.d/zephyr.ps1.
  # NB: backslash-escape the $ in $env: (\$env:) — in an UNQUOTED heredoc a
  # backtick is command substitution, not an escape, so `` `$env `` would try to
  # expand the unbound `env` under `set -u` and abort. \$ produces a literal $.
  cat > "$ENV_PREFIX/etc/conda/env-vars.ps1" <<EOF
# Resolved by the typeCAD Zephyr installer. Dot-sourced by etc/conda/activate.d/zephyr.ps1.
\$env:TYPECAD_ZEPHYR_BASE = "$zb"
\$env:TYPECAD_ZEPHYR_SDK_INSTALL_DIR = "$ZEPHYR_SDK_INSTALL_DIR"
EOF

  # Static hooks (shell-agnostic; they only read env-vars.*).
  cp "$PKG_DIR/etc/conda/activate.d/zephyr.sh"   "$act_dst/zephyr.sh"
  cp "$PKG_DIR/etc/conda/activate.d/zephyr.bat"  "$act_dst/zephyr.bat"
  cp "$PKG_DIR/etc/conda/activate.d/zephyr.ps1"  "$act_dst/zephyr.ps1"
  cp "$PKG_DIR/etc/conda/deactivate.d/zephyr.sh"   "$deact_dst/zephyr.sh"
  cp "$PKG_DIR/etc/conda/deactivate.d/zephyr.bat"  "$deact_dst/zephyr.bat"
  cp "$PKG_DIR/etc/conda/deactivate.d/zephyr.ps1"  "$deact_dst/zephyr.ps1"

  echo "write-activation: done"
}
