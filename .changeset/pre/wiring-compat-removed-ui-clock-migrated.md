---
'@typecad/hal': minor
'@typecad/cuttlefish': minor
'@typecad/ui': minor
'@typecad/framework-zephyr': minor
---

Remove the Arduino wiring-compat layer and migrate the runtimes onto a
thin-HAL clock contract.

Wiring compat deleted: the Zephyr strategy no longer detects or shims bare
wiring calls — pinMode/digitalWrite (and the INPUT/OUTPUT/INPUT_PULLUP/
HIGH/LOW #defines they needed), pulseIn/pulseInLong (__tc_wiring_pulse_in),
and the bare shiftOut/shiftIn shims are gone; the ambient detector now only
carries the live APIs (random/randomSeed, noInterrupts/interrupts). The
free-function pwmWrite/tonePlay/toneStop/wdtEnable/wdtReset/httpSendStart
stubs and their plugin cases are removed, and with them the orphaned
pwm.write, tone.play and tone.stop op kinds end-to-end (IR union, kinds
registry, lowering, manifest, peripheral-usage, capability/validation arms).
http.send_start stays — the async state machine produces it directly for
awaited HTTP. Pin-capability and mode-validation now key on the thin
pwm.set_pulse/set_duty/set_period/tone ops.

safety: the pin-mode intercept is rebuilt on the thin HAL — v3 scans
gpio.configure/gpio.read_cfg flag tokens (pure token lists only; runtime
expressions record Unknown; open-drain counts as Output) and injects the
same safety.record_pin_mode companion, so safe.read's mode verification
works again on thin-HAL programs.

Runtime clock contract: millis() is replaced by __tc_now_ms() — Zephyr
defines it as k_uptime_get_32(), native as a steady_clock count, and the
async/promise runtimes, cooperative scheduler, and the UI per-frame tick
all lower onto it via currentTimeMillis(). The micros/map/constrain shims
and their gating machinery are deleted. The UI runtime header now declares
the clock extern and carries its own __ui_constrain clamp instead of
calling the Arduino-named helpers; the byte-identity baseline is
regenerated. Programs that can never read the clock get the definition
stripped from the emitted header.
