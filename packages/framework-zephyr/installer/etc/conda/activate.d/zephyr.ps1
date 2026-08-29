# typeCAD Zephyr installer - activation hook (PowerShell).
#
# Dot-sources the resolved env-vars written at install time, then exports the
# two env vars framework-zephyr's west discovery expects. With these set and
# `west` on PATH, discoverFromPath() wins immediately.
# See packages/framework-zephyr/src/toolchain/west-discover.ts.
if ($env:CONDA_PREFIX) {
    $envVars = Join-Path $env:CONDA_PREFIX "etc/conda/env-vars.ps1"
    if (Test-Path $envVars) { . $envVars }
}
if ($env:TYPECAD_ZEPHYR_BASE) { $env:ZEPHYR_BASE = $env:TYPECAD_ZEPHYR_BASE }
if ($env:TYPECAD_ZEPHYR_SDK_INSTALL_DIR) { $env:ZEPHYR_SDK_INSTALL_DIR = $env:TYPECAD_ZEPHYR_SDK_INSTALL_DIR }
