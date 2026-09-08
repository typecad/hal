# ---------------------------------------------------------------------------
# typeCAD Zephyr - per-project env activator (bash / zsh).
#
# Source:   source .typecad/activate-zephyr.sh
# Auto-run on terminal open: use direnv (.envrc -> source this file) or a VS
# Code bash terminal profile with --rcfile.
#
# Activates the micromamba env created by the typeCAD Zephyr installer. After
# activation, `west` is on PATH and ZEPHYR_BASE / ZEPHYR_SDK_INSTALL_DIR point
# at the new install, so `npx typecad-hal build` uses it automatically.
#
# Override the env name with $TYPECAD_ZEPHYR_ENV (default: "zephyr").
# ---------------------------------------------------------------------------
EnvName="${TYPECAD_ZEPHYR_ENV:-zephyr}"

# Load the micromamba shell hook if it isn't already on PATH.
if ! command -v micromamba >/dev/null 2>&1; then
  mm="$HOME/micromamba/bin/micromamba"
  if [ ! -x "$mm" ]; then
    echo "micromamba not found at $mm. Run the typeCAD Zephyr installer first:" >&2
    echo "  node packages/framework-zephyr/installer/install.mjs" >&2
    # `return` when sourced, `exit` when executed.
    return 1 2>/dev/null || exit 1
  fi
  eval "$("$mm" shell hook --shell bash)"
fi

micromamba activate "$EnvName"

echo "typeCAD Zephyr: activated '$EnvName' -> $(command -v west)"
echo "  ZEPHYR_BASE = $ZEPHYR_BASE"
