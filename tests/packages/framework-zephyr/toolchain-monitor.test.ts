import { describe, it, expect } from 'vitest';
import { serialPortWaitArgs, MONITOR_PORT_WAIT_MS } from '../../../packages/framework-zephyr/src/toolchain';

// The pre-miniterm port wait (post-flash re-enumeration race): monitor()
// polls pyserial's list_ports until the device name reappears before handing
// off to miniterm's single open. The python runs in the west venv, so the
// unit-testable surface is the argv builder and the poll script's contract.

describe('serialPortWaitArgs (monitor re-enumeration wait)', () => {
  it('passes the port and the timeout in seconds', () => {
    const [flag, code, port, timeout] = serialPortWaitArgs('COM13', 8000);
    expect(flag).toBe('-c');
    expect(port).toBe('COM13');
    expect(timeout).toBe('8');
    expect(typeof code).toBe('string');
  });

  it('polls list_ports without opening the port (DTR toggling can reset boards)', () => {
    const code = serialPortWaitArgs('COM13', 8000)[1]!;
    expect(code).toContain('from serial.tools import list_ports');
    expect(code).toContain('list_ports.comports()');
    expect(code).not.toContain('serial.Serial(');
    expect(code).not.toContain('Serial(');
  });

  it('matches the device name case-insensitively (com13 vs COM13)', () => {
    expect(serialPortWaitArgs('COM13', 8000)[1]).toContain('d.device.lower() == port.lower()');
  });

  it('exits 2 when pyserial is unavailable so miniterm surfaces the real error', () => {
    const code = serialPortWaitArgs('COM13', 8000)[1]!;
    expect(code).toContain('sys.exit(2)');
    expect(code).toContain('sys.exit(1)'); // timeout, after the poll loop
  });

  it('announces the wait and names the port in the timeout message', () => {
    const code = serialPortWaitArgs('COM13', 8000)[1]!;
    expect(code).toContain('waiting for %s to re-enumerate');
    expect(code).toContain('did not come back within');
  });
});

describe('MONITOR_PORT_WAIT_MS', () => {
  it('is a sane bounded wait', () => {
    expect(MONITOR_PORT_WAIT_MS).toBeGreaterThanOrEqual(2000);
    expect(MONITOR_PORT_WAIT_MS).toBeLessThanOrEqual(30000);
  });
});
