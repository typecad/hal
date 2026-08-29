# typeCAD Zephyr installer - deactivation hook (PowerShell).
# Removes everything the activation hook set.
Remove-Item Env:ZEPHYR_BASE -ErrorAction SilentlyContinue
Remove-Item Env:ZEPHYR_SDK_INSTALL_DIR -ErrorAction SilentlyContinue
Remove-Item Env:TYPECAD_ZEPHYR_BASE -ErrorAction SilentlyContinue
Remove-Item Env:TYPECAD_ZEPHYR_SDK_INSTALL_DIR -ErrorAction SilentlyContinue
