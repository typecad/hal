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
  if [ -d "$WORKSPACE_DIR/.west" ] && [ -f "$WORKSPACE_DIR/.west/config" ]; then
    echo "init-workspace: $WORKSPACE_DIR already initialized — running west update only"
    # A workspace adopted from a pre-existing install (or initialized by an
    # older installer) can track a branch or an older tag — plain `west update`
    # never moves the manifest repository, so it drifts out of sync with the
    # SDK this installer pins. Re-pin the revision AND check the tag out so
    # west update below syncs modules against the pinned manifest.
    if cur_rev="$(cd "$WORKSPACE_DIR" && "$MAMBA" run -n "$ENV_NAME" west config manifest.revision 2>/dev/null)"; then
      :
    else
      cur_rev=""
    fi
    if [ "$cur_rev" != "$ZEPHYR_MANIFEST_REV" ]; then
      echo "init-workspace: pinning manifest revision -> $ZEPHYR_MANIFEST_REV (was: ${cur_rev:-<unset - default branch>})"
    fi
    # All three steps are idempotent; they must also run when the config
    # already says the right thing but the tree is still on the old revision.
    (cd "$WORKSPACE_DIR" && "$MAMBA" run -n "$ENV_NAME" west config manifest.revision "$ZEPHYR_MANIFEST_REV") \
      || { echo "init-workspace: west config manifest.revision failed" >&2; return 1; }
    "$MAMBA" run -n "$ENV_NAME" git -C "$WORKSPACE_DIR/zephyr" fetch origin "refs/tags/$ZEPHYR_MANIFEST_REV:refs/tags/$ZEPHYR_MANIFEST_REV" \
      || { echo "init-workspace: git fetch tag $ZEPHYR_MANIFEST_REV failed" >&2; return 1; }
    "$MAMBA" run -n "$ENV_NAME" git -C "$WORKSPACE_DIR/zephyr" checkout "$ZEPHYR_MANIFEST_REV" \
      || { echo "init-workspace: git checkout $ZEPHYR_MANIFEST_REV failed (dirty zephyr tree?)" >&2; return 1; }
  else
    if [ -d "$WORKSPACE_DIR/.west" ]; then
      echo "init-workspace: $WORKSPACE_DIR/.west exists but its config is missing (interrupted init?) — re-initializing"
      rm -rf "$WORKSPACE_DIR/.west"
    fi
    mkdir -p "$(dirname "$WORKSPACE_DIR")"
    "$MAMBA" run -n "$ENV_NAME" west init -m "$ZEPHYR_MANIFEST_URL" --mr "$ZEPHYR_MANIFEST_REV" "$WORKSPACE_DIR" \
      || { echo "init-workspace: west init failed" >&2; return 1; }
  fi

  # west update pulls zephyr + all modules. Slow the first time (large clone).
  echo "init-workspace: running west update (this fetches zephyr + modules)..."
  "$MAMBA" run -n "$ENV_NAME" west update \
    || { echo "init-workspace: west update failed" >&2; return 1; }

  # Workspace patches — upstream fixes the pinned manifest revisions don't
  # carry yet (see patches/*.patch). `git apply --check` makes this
  # idempotent: an already-applied (or already-upstreamed) patch is skipped,
  # never a hard failure. Each patch carries a `# typecad-repo: <path>`
  # header naming its workspace repo (first-directory guesses break on
  # nested projects like modules/tee/tf-m/trusted-firmware-m).
  if [ -d "$PKG_DIR/patches" ]; then
    for patch in "$PKG_DIR"/patches/*.patch; do
      [ -f "$patch" ] || continue
      repo_name=$(grep -m1 '^# typecad-repo:' "$patch" | sed 's/^# typecad-repo:[[:space:]]*//')
      if [ -z "$repo_name" ]; then
        echo "init-workspace: WARNING: $(basename "$patch") — no 'typecad-repo:' header, skipping" >&2
        continue
      fi
      repo_dir="$WORKSPACE_DIR/$repo_name"
      if [ ! -d "$repo_dir" ]; then
        echo "init-workspace: WARNING: $(basename "$patch") — $repo_dir not present, skipping" >&2
        continue
      fi
      echo "init-workspace: applying patch $(basename "$patch") to $repo_name..."
      if git -C "$repo_dir" apply --check "$patch" 2>/dev/null; then
        git -C "$repo_dir" apply "$patch" \
          || { echo "init-workspace: patch apply failed: $(basename "$patch")" >&2; return 1; }
      else
        echo "init-workspace:   already applied (or inapplicable) — skipping"
      fi
    done
  fi

  # Install Zephyr's pinned Python build deps (jsonschema, pykwalify, PyYAML,
  # intelhex, canopen, ...) into the env. CMake checks for these and the build
  # fails with e.g. "Missing jsonschema dependency" without them. Letting
  # Zephyr's own requirements file drive this avoids chasing deps one-by-one
  # and tracks the pinned Zephyr revision.
  echo "init-workspace: installing Zephyr Python requirements (requirements-base.txt)..."
  "$MAMBA" run -n "$ENV_NAME" pip install -r "$WORKSPACE_DIR/zephyr/scripts/requirements-base.txt" \
    || { echo "init-workspace: pip install requirements failed" >&2; return 1; }

  # imgtool — MCUboot's signing tool. Not in requirements-base.txt, but TF-M /
  # FVP signing steps invoke it as a module (mps4 corstone builds fail with
  # "No module named 'imgtool'" without it).
  echo "init-workspace: installing imgtool (MCUboot signing tool)..."
  "$MAMBA" run -n "$ENV_NAME" pip install imgtool \
    || echo "init-workspace: WARNING: imgtool install failed — TF-M/FVP signing will not work" >&2

  # TF-M secure-build tooling: the inner TF-M build's bl2_image_config step
  # parses compile_commands (needs the `clang` python bindings) and Nordic's
  # RTE_Device.h needs devicetree headers — requirements + libclang (native
  # library the python `clang` bindings load) from conda-forge.
  tfm_tools="$WORKSPACE_DIR/modules/tee/tf-m/trusted-firmware-m/tools/requirements.txt"
  if [ -f "$tfm_tools" ]; then
    echo "init-workspace: installing TF-M tools requirements..."
    "$MAMBA" run -n "$ENV_NAME" pip install -r "$tfm_tools" >/dev/null 2>&1 \
      || echo "init-workspace:   WARNING: TF-M tools requirements install failed" >&2
  fi
  echo "init-workspace: installing libclang (conda-forge)..."
  "$MAMBA" install -n "$ENV_NAME" -c conda-forge libclang -y \
    || echo "init-workspace:   WARNING: libclang install failed — TF-M bl2 config step will fail" >&2

  # Build-relevant per-module Python requirements ONLY. A bare `find -name
  # requirements.txt` would also pull docs/test/harness/example requirements
  # (mbedtls docs, openthread harness, cmsis tests, lvgl docs, tf-m tools) — heavy
  # and conflict-prone. Restrict to locations holding actual build tooling: HAL
  # scripts/zephyr dirs (esptool for espressif, vendor flash/script tools) and
  # top-level lib codegen (nanopb, zcbor). Board support itself is universal —
  # west fetched every module and the SDK ships every cross-toolchain — so these
  # are the few extras a build needs beyond requirements-base.txt.
  echo "init-workspace: installing per-module Python requirements (build tooling only)..."
  for req in \
    "$WORKSPACE_DIR"/modules/hal/*/scripts/requirements.txt \
    "$WORKSPACE_DIR"/modules/hal/*/zephyr/requirements.txt \
    "$WORKSPACE_DIR"/modules/lib/*/requirements.txt \
    "$WORKSPACE_DIR"/modules/lib/*/scripts/requirements.txt
  do
    [ -f "$req" ] || continue
    echo "init-workspace:   module requirements: ${req#"$WORKSPACE_DIR"/}"
    "$MAMBA" run -n "$ENV_NAME" pip install -r "$req" >/dev/null 2>&1 \
      || echo "init-workspace:   WARNING: module requirements install failed: $req" >&2
  done

  echo "init-workspace: done — ZEPHYR_BASE=$WORKSPACE_DIR/zephyr"
}
