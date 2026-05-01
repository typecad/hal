import { D4, D9, A0 } from '@typehal';

D4.pwm(50);      // Error: D4 does not support PWM on this board
D9.pwm(50);      // OK: D9 is a PWM pin
A0.readAnalog(); // OK: A0 is an analog pin
D9.readAnalog(); // Error: D9 does not have an ADC