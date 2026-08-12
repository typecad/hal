@echo off
REM typeCAD Zephyr installer - activation hook (cmd.exe).
REM Calls the resolved env-vars, then exports ZEPHYR_BASE + ZEPHYR_SDK_INSTALL_DIR.
REM See packages/framework-zephyr/src/toolchain/west-discover.ts (Strategy 1).
if exist "%CONDA_PREFIX%\etc\conda\env-vars.bat" call "%CONDA_PREFIX%\etc\conda\env-vars.bat"
if defined TYPECAD_ZEPHYR_BASE set "ZEPHYR_BASE=%TYPECAD_ZEPHYR_BASE%"
if defined TYPECAD_ZEPHYR_SDK_INSTALL_DIR set "ZEPHYR_SDK_INSTALL_DIR=%TYPECAD_ZEPHYR_SDK_INSTALL_DIR%"
