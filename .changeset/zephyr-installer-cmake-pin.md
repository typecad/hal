---
"@typecad/zephyr-installer": patch
---

## Pin cmake <4 (Zephyr 4.3.x is incompatible with CMake 4.x)

Fresh installs resolved `cmake 4.4.x` (the `cmake>=3.20` constraint had no
upper bound), and `west build` then failed at CMake configure:

```
CMake Error at .../cmake/modules/FindZephyr-sdk.cmake:57 (if):
  if given arguments:
    "(" "zephyr" "STREQUAL" ")" "OR" ...
  Unknown arguments specified
```

Zephyr 4.3.x's `FindZephyr-sdk.cmake` uses an **unquoted** `${ZEPHYR_TOOLCHAIN_VARIANT}`
in an `if()`. When that variable is undefined it expands to nothing; CMake **3.x**
treats the empty expansion leniently (as an empty string), but CMake **4.x**
rejects it as an unknown argument. Zephyr 4.3.x predates CMake 4.x.

`environment.yml` now constrains `cmake>=3.20,<4` so conda resolves a 3.x
(currently 3.31.x). Loosen once a Zephyr revision that supports CMake 4.x is
pinned in `versions.env`. Guarded by a test asserting the upper bound is present.
