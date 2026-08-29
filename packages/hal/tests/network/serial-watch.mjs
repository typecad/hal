// Raw serial watcher for the BLE diagnostic: opens COM9, pulses the DTR/RTS
// reset (the CH34x auto-download trap), prints everything for N seconds.
import { SerialPort } from 'serialport';
const port = new SerialPort({ path: 'COM9', baudRate: 115200, autoOpen: false });
const DURATION = parseInt(process.argv[2] ?? '90', 10) * 1000;
port.open(async (err) => {
  if (err) { console.error('open failed:', err.message); process.exit(1); }
  // Pulse EN via DTR/RTS (mirrors the expect rig's resetAfterOpen).
  port.set({ dtr: true, rts: true }, () => {});
  await new Promise((r) => setTimeout(r, 120));
  port.set({ dtr: false, rts: false }, () => {});
  console.log(`[watch] reading COM9 for ${DURATION / 1000}s`);
});
port.on('data', (d) => process.stdout.write(d.toString()));
port.on('error', (e) => console.error('[watch] serial error:', e.message));
setTimeout(() => { console.log('\n[watch] done'); process.exit(0); }, DURATION);
