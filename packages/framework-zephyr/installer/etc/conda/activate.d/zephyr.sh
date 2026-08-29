# typeCAD Zephyr installer — activation hook (POSIX bash/zsh).
#
# Sources the resolved paths written at install time (etc/conda/env-vars.sh),
# then exports the two env vars that framework-zephyr's west discovery expects:
#
#   ZEPHYR_BASE            — west-discover.ts Strategy 1 reads process.env.ZEPHYR_BASE.
#   ZEPHYR_SDK_INSTALL_DIR — Zephyr's CMake finds the cross-toolchain here.
#
# With these set and `west` on PATH (the conda env provides it), discoverFromPath()
# wins immediately and no other discovery strategy is needed. See
# packages/framework-zephyr/src/toolchain/west-discover.ts.
if [ -n "${CONDA_PREFIX:-}" ] && [ -f "${CONDA_PREFIX}/etc/conda/env-vars.sh" ]; then
  . "${CONDA_PREFIX}/etc/conda/env-vars.sh"
fi
if [ -n "${TYPECAD_ZEPHYR_BASE:-}" ]; then
  export ZEPHYR_BASE="${TYPECAD_ZEPHYR_BASE}"
fi
if [ -n "${TYPECAD_ZEPHYR_SDK_INSTALL_DIR:-}" ]; then
  export ZEPHYR_SDK_INSTALL_DIR="${TYPECAD_ZEPHYR_SDK_INSTALL_DIR}"
fi
