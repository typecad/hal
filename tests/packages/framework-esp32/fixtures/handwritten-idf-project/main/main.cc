// Spike: minimal app_main that prints and loops.
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static void app_task(void *arg) {
    (void)arg;
    printf("hello from idf.py app_main\n");
    fflush(stdout);
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

extern "C" void app_main(void) {
    xTaskCreate(app_task, "app_task", 4096, NULL, 1, NULL);
}
