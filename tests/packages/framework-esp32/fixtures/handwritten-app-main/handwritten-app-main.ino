// Spike: prove a sketch-level app_main preempts the arduino-esp32 core's.
// Expected behavior: compiles cleanly, links against our app_main (not the
// core's loopTask-based main.cpp).
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static void app_task(void *arg) {
    (void)arg;
    printf("hello from preempted app_main\n");
    fflush(stdout);
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

extern "C" void app_main(void) {
    xTaskCreate(app_task, "app_task", 4096, NULL, 1, NULL);
}
