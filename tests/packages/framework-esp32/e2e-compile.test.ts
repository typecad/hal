import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileEspIdf } from '../../../packages/framework-esp32/src/toolchain/compile';
import { scaffoldEspIdfProject } from '../../../packages/framework-esp32/src/toolchain/scaffold';
import { detectIdfEnv } from '../../../packages/framework-esp32/src/toolchain/idf-env';

function idfEnvAvailable(): boolean {
  return detectIdfEnv().available;
}

const SKIP = !idfEnvAvailable();
const itMaybe = SKIP ? it.skip : it;

// Hand-written minimal main.cc that mirrors what the framework would emit.
// We can't easily run the full cuttlefish transpile in a unit test (it needs
// a config + entry file + the cuttlefish CLI), so this exercises the toolchain
// (scaffold + compile) end-to-end against a hand-written project.
const HAND_WRITTEN_MAIN_CC = `
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_timer.h"

static void app_task(void *arg) {
    (void)arg;
    bool on = false;
    const gpio_num_t led = GPIO_NUM_2;
    gpio_reset_pin(led);
    gpio_set_direction(led, GPIO_MODE_OUTPUT);
    for (;;) {
        on = !on;
        gpio_set_level(led, on ? 1 : 0);
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

extern "C" void app_main(void) {
    xTaskCreate(app_task, "app_task", 4096, NULL, 1, NULL);
}
`;

describe('framework-esp32 end-to-end compile', () => {
  itMaybe('scaffolds and compiles a blink program via idf.py build for esp32', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'tc-esp32-e2e-'));
    try {
      // 1. Scaffold the ESP-IDF project skeleton
      scaffoldEspIdfProject(outDir, 'esp32');

      // 2. Write the main.cc the framework would generate
      const fs = require('node:fs');
      fs.writeFileSync(join(outDir, 'main', 'main.cc'), HAND_WRITTEN_MAIN_CC);

      // 3. Compile via the toolchain
      const result = compileEspIdf({ sourcePath: outDir, target: 'esp32' });
      const combined = result.output;
      expect(result.success).toBe(true);
      expect(combined).toMatch(/Project build complete|Generated.*\.bin/);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 600000);
});

// Structural test — always runs, no ESP-IDF needed. Verifies the scaffold +
// main.cc shape is internally consistent (the e2e would compile this if ESP-IDF
// were available).
describe('framework-esp32 e2e structural verification', () => {
  it('scaffold produces a project that references main.cc and CONFIG_IDF_TARGET', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'tc-esp32-struct-'));
    try {
      scaffoldEspIdfProject(outDir, 'esp32');
      const fs = require('node:fs');
      const rootCmake = fs.readFileSync(join(outDir, 'CMakeLists.txt'), 'utf8');
      const mainCmake = fs.readFileSync(join(outDir, 'main', 'CMakeLists.txt'), 'utf8');
      const sdkconfig = fs.readFileSync(join(outDir, 'sdkconfig.defaults'), 'utf8');
      expect(rootCmake).toMatch(/project\.cmake/);
      expect(mainCmake).toMatch(/SRCS "main\.cc"/);
      expect(sdkconfig).toMatch(/CONFIG_IDF_TARGET="esp32"/);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('the blink fixture imports from @typecad/hal', () => {
    const fixture = require('node:fs').readFileSync(
      join(__dirname, 'fixtures', 'minimal-blink.ts'), 'utf8',
    );
    expect(fixture).toMatch(/from ['"]@typecad\/hal['"]/);
    expect(fixture).toMatch(/OutputPin/);
    expect(fixture).toMatch(/Timing\.delay/);
  });
});
