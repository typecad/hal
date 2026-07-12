# native_demo

A native-desktop demo of the Cuttlefish UI runtime rendered to an SDL2 window.
This is the proving ground for the **RGB888 color pipeline + SDL native render
layer**: it runs the real C++ `ui_tick` reactive runtime (the same code path as
the ESP32 build) against an SDL-backed display adapter that renders true 24-bit
color to a window. The mouse is the touch source.

## Prerequisites

SDL2 must be installed on the host (the `g++`/`clang++` toolchain is also
required, as for any `@typecad/framework-native` build).

| Platform | Install |
|----------|---------|
| Linux (Debian/Ubuntu) | `sudo apt install libsdl2-dev build-essential` |
| macOS | `brew install sdl2` (and a compiler via Xcode command-line tools) |
| Windows | Install [MSYS2](https://www.msys2.org/), then in the **ucrt64** shell: `pacman -S mingw-w64-ucrt-x86_64-SDL2 mingw-w64-ucrt-x86_64-gcc`. Ensure `C:\msys64\ucrt64\bin` is on `PATH`. |

> **Windows link note:** the config links with `-lSDL2`. If the linker reports
> unresolved `WinMain`/`SDL_main` symbols, expand the `native.libraries` array
> in `cuttlefish.config.ts` to `["mingw32", "SDL2main", "SDL2"]` and add
> `libraryPaths: ["C:\\msys64\\ucrt64\\lib"]`. Linux/macOS need only `["SDL2"]`.

## Build & run

```sh
npm run compile --workspace native_demo   # transpile + g++/clang++ → exe
# then run the produced binary:
./native_demo/out/main/main        # Linux/macOS
native_demo\out\main\main.exe      # Windows
```

A 320×240 window opens showing a gradient banner, a header, and a button.
Click the button (mouse = touch) to increment the counter — this exercises the
full reactive path: mouse → `touch_*` shim → `ui_tick` → binding callback →
reactive redraw → `display_present`.

## What this demonstrates

- **True RGB888 end-to-end.** The `colorFormat: 'rgb888'` config sets
  `UI_COLOR_DEPTH 888`, so node colors hold full 24-bit values and the SDL
  adapter receives them as `uint32_t` (no 565 quantization). The gradient and
  `:active` color change show 888 fidelity vs. a 565 TFT.
- **The real device code path on desktop.** Unlike the browser preview (a TS
  reimplementation), this is the compiled C++ reactive runtime — the same
  `ui_tick` the ESP32 build runs, with SDL as the sink instead of SPI.
- **Mouse-as-touch.** The `sdl` touch library maps `SDL_GetMouseState` onto the
  existing `touch_isTouched`/`touch_readRaw` contract, so scrolling/drag/tap
  work via the mouse with zero runtime changes.
