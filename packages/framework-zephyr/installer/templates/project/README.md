# typeCAD Zephyr — per-project activation template

Copy these files into a typecad-hal Zephyr project so that opening a terminal in
it auto-activates the micromamba env created by the typeCAD Zephyr installer.
Once active, `west` is on PATH and `ZEPHYR_BASE` / `ZEPHYR_SDK_INSTALL_DIR` are
set, so `npx typecad-hal build` uses the new install automatically — no
per-session `micromamba activate` typing.

## Files

| File | Role |
| --- | --- |
| `.typecad/activate-zephyr.ps1` | Windows activator. Run: `. .\.typecad\activate-zephyr.ps1` |
| `.typecad/activate-zephyr.sh` | POSIX activator (bash/zsh). Source: `source .typecad/activate-zephyr.sh` |
| `.vscode/settings.json` | VS Code terminal profile that auto-runs the Windows activator on every new terminal |

Both activators are **machine-agnostic** — they find micromamba via
`$USERPROFILE\micromamba\…` / `$HOME/micromamba/…` and the env name, so the
same files work across machines with no hardcoded absolute paths.

## Install into a project

From the project root:

```sh
cp -r packages/framework-zephyr/installer/templates/project/.typecad ./
mkdir -p .vscode
cp    packages/framework-zephyr/installer/templates/project/.vscode/settings.json ./.vscode/settings.json
```

If the project **already** has a `.vscode/settings.json`, **merge** the
`terminal.integrated.*` keys in by hand — don't overwrite the whole file.

## Default vs. opt-in

The shipped `settings.json` sets `terminal.integrated.defaultProfile.windows` so
activation is **automatic** on every new terminal — correct for a dedicated
Zephyr project. In a **multi-framework** workspace (e.g. the typecode monorepo,
which also does ESP-IDF/Arduino), delete the `defaultProfile.windows` line so
the profile is opt-in via the terminal dropdown instead — otherwise every
terminal inherits the Zephyr env and clashes with the other toolchains.

## macOS / Linux

VS Code terminal auto-activation on POSIX isn't wired here (the Windows path is
where the activation friction was highest). Two options:

- **direnv** (recommended): add a `.envrc` to the project containing
  `source .typecad/activate-zephyr.sh`. direnv auto-sources it on `cd` in.
- A VS Code bash terminal profile using `--rcfile` that sources both
  `~/.bashrc` and the activator.

The `.sh` activator is safe to source repeatedly and is direnv-compatible.

## Override the env name

Set `TYPECAD_ZEPHYR_ENV` before activating to target a differently-named env
(default: `zephyr`), e.g. if you maintain multiple SDK versions side by side.
