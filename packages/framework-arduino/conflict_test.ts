
import { SPI0, D13 } from '@typehal/board-arduino-uno';

// SPI0 uses D11, D12, D13
SPI0.begin();

// Conflicting usage of D13
D13.asOutput();
D13.high();
