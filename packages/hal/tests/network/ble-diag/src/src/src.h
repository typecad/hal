#pragma once
#include <zephyr/kernel.h>
#include <zephyr/drivers/gpio.h>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/bluetooth/uuid.h>
#include <stdio.h>
#include <stdlib.h>


extern double setpoint;
extern double connects;

double main_isr_0();
double main_isr_1();
double main_isr_2();
double main_isr_3();
double main_isr_4();
double main_isr_5();
std::string main_isr_6();
