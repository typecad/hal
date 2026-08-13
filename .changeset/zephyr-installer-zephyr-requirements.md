---
"@typecad/zephyr-installer": patch
---

## Install Zephyr's Python build requirements into the env

After `west update`, the installer now runs
`pip install -r $ZEPHYR_BASE/scripts/requirements-base.txt` into the `zephyr`
conda env. Without this, `west build` failed at CMake configure:

```
CMake Error at .../zephyr_module.cmake:73 (message):
  Missing jsonschema dependency
```

`environment.yml` only carried `pyelftools` + `packaging`; Zephyr additionally
requires `jsonschema`, `pykwalify`, `PyYAML`, `intelhex`, `canopen`, `patool`,
`psutil`, `pyserial`, `requests`, `semver`, `tqdm`, `reuse`, `anytree`, and
`windows-curses` (Windows). Letting Zephyr's own pinned requirements file drive
the install tracks the Zephyr revision and avoids maintaining a separate list
that goes stale or misses deps.

Mirrored in `install.sh` (POSIX) and `install.ps1` (Windows), fail-fast on a
pip failure. Guarded by a regression test asserting both scripts wire
`requirements-base.txt`.
