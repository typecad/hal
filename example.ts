import { Board } from "typecode-implementation/board-arduino-uno";

Serial.begin(9600);

function loop(){
var x = Board.A0.read();
console.log(x);
delay(500);
}