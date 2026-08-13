#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# init-workspace.sh — west init + west update a vanilla Zephyr workspace.
# Sourced by install.sh. Defines init_workspace(), which reads:
#
#   ZEPHYR_MANIFEST_URL, ZEPHYR_MANIFEST_REV  (versions.env)
#   WORKSPACE_DIR                             (resolved by install.sh)
#   ENV_NAME                                  (versions.env)
#   MAMBA                                     (micromamba binary path, install.sh)
#   MAMBA_ROOT_PREFIX                         (resolved by install.sh)
#   DRY_RUN                                   (install.sh flag)
#
# Uses `west init -m <url> --mr <rev> <dir>` to pin the manifest to a specific
# Zephyr tag, then `west update` to fetch zephyr + all manifest projects. The
# resulting <WORKSPACE_DIR>/zephyr/ is what ZEPHYR_BASE points at.
#
# Idempotent: if <WORKSPACE_DIR>/.west already exists, skips init and only
# updates. micromamba run -n runs west in the env without sourcing activation
# hooks (west is found on the env's PATH); activation is the user's later step.
# ---------------------------------------------------------------------------

init_workspace() {
  echo "init-workspace: west init $WORKSPACE_DIR"
  echo "init-workspace:   manifest: $ZEPHYR_MANIFEST_URL @ $ZEPHYR_MANIFEST_REV"

  if [ "$DRY_RUN" = "1" ]; then
    echo "init-workspace: [DRY-RUN] would run: $MAMBA run -n $ENV_NAME west init -m $ZEPHYR_MANIFEST_URL --mr $ZEPHYR_MANIFEST_REV $WORKSPACE_DIR"
    echo "init-workspace: [DRY-RUN] would run: $MAMBA run -n $ENV_NAME west update"
    echo "init-workspace: [DRY-RUN] would set ZEPHYR_BASE=$WORKSPACE_DIR/zephyr"
    return 0
  fi

  export MAMBA_ROOT_PREFIX
  if [ -d "$WORKSPACE_DIR/.west" ]; then
    echo "init-workspace: $WORKSPACE_DIR already initialized — running west update only"
  else
    mkdir -p "$(dirname "$WORKSPACE_DIR")"
    "$MAMBA" run -n "$ENV_NAME" west init -m "$ZEPHYR_MANIFEST_URL" --mr "$ZEPHYR_MANIFEST_REV" "$WORKSPACE_DIR" \
      || { echo "init-workspace: west init failed" >&2; return 1; }
  fi

  # west update pulls zephyr + all modules. Slow the first time (large clone).
  echo "init-workspace: running west update (this fetches zephyr + modules)..."
  "$MAMBA" run -n "$ENV_NAME" west update \
    || { echo "init-workspace: west update failed" >&2; return 1; }

  # Install Zephyr's pinned Python build deps (jsonschema, pykwalify, PyYAML,
  # intelhex, canopen, ...) into the env. CMake checks for these and the build
  # fails with e.g. "Missing jsonschema dependency" without them. Letting
  # Zephyr's own requirements file drive this avoids chasing deps one-by-one
  # and tracks the pinned Zephyr revision.
  echo "init-workspace: installing Zephyr Python requirements (requirements-base.txt)..."
  "$MAMBA" run -n "$ENV_NAME" pip install -r "$WORKSPACE_DIR/zephyr/scripts/requirements-base.txt" \
    || { echo "init-workspace: pip install requirements failed" >&2; return 1; }

  echo "init-workspace: done — ZEPHYR_BASE=$WORKSPACE_DIR/zephyr"
}
