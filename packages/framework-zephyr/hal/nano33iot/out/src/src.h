#pragma once
#include <zephyr/kernel.h>
#include <zephyr/drivers/gpio.h>
#include <cstdint>
#include <cstdio>
#include <zephyr/drivers/i2c.h>
#include <zephyr/drivers/spi.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/usb/usbd.h>
#include <zephyr/init.h>
#include <cmsis_core.h>
#include <zephyr/drivers/adc.h>


void main_isr_0();
