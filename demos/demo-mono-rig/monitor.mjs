// Serial monitor for the mono rig test — streams the firmware's TC_DISPLAY
// diagnostics over the same USB port you flash with.
//
//   node demos/demo-mono-rig/monitor.mjs            # auto-pick the first port
//   node demos/demo-mono-rig/monitor.mjs COM7        # explicit port
//
// What the lines mean:
//   "TC_DISPLAY: mono full-frame transport ..."     adapter started
//   "TC_DISPLAY: panel reports 128x64 fmt=..."      driver init SUCCEEDED over I2C
//   "TC_DISPLAY: device not ready ..."              I2C init failed: address/power/wiring
//   "TC_DISPLAY: mono frame #N pushed"              frames are flowing to the panel
//   "TC_DISPLAY: display_write failed: -5"          EIO = I2C NACK (wrong address?)
//                                                   -19 = device not initialized
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

const baud = 115200;
let portPath = process.argv[2];

if (!portPath) {
  const ports = await SerialPort.list();
  const usb = ports.filter((p) => /usb|JTAG|SERIAL/i.test(p.manufacturer ?? "") || /COM\d+/i.test(p.path));
  if (usb.length === 0) {
    console.error("No serial ports found. Pass one explicitly: node monitor.mjs COM7");
    console.error("Available:", ports.map((p) => p.path).join(", ") || "(none)");
    process.exit(1);
  }
  portPath = usb[0].path;
  if (usb.length > 1) {
    console.error(`Multiple ports (${usb.map((p) => p.path).join(", ")}); using ${portPath}`);
  }
}

console.log(`# monitoring ${portPath} @ ${baud} — Ctrl+C to stop`);
const port = new SerialPort({ path: portPath, baudRate: baud, autoOpen: true });
port.pipe(new ReadlineParser()).on("data", (line) => console.log(line));
port.on("error", (err) => {
  console.error("serial error:", err.message);
  process.exit(1);
});
