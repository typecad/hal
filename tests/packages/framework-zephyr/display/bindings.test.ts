import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import {
  readDisplayBindingFrom,
  listBoundDisplayCompatibles,
  __setDisplayBindingRootOverride,
} from '../../../../packages/framework-zephyr/src/display/bindings';

const FIXTURES = join(__dirname, '..', '..', '..', 'fixtures', 'display-bindings');

afterEach(() => {
  __setDisplayBindingRootOverride(undefined);
});

describe('display binding harvest (fixtures)', () => {
  it('harvests required props with defaults in either YAML order', () => {
    const b = readDisplayBindingFrom('sitronix,st7796s', FIXTURES)!;
    expect(b).toBeTruthy();
    // pgc declares default BEFORE required; ngc after — both must resolve.
    expect(b.required.get('pgc')?.default).toEqual({ kind: 'bytes', value: [0xf0, 0x09, 0x0b, 0x06] });
    expect(b.required.get('ngc')?.default).toEqual({ kind: 'bytes', value: [0xf0, 0x09] });
    // madctl is OPTIONAL in the (real-shape) fixture — required-only harvest
  // skips it, but the prop-name set knows it exists (rotation flows there).
  expect(b.required.has('madctl')).toBe(false);
  expect(b.props.has('madctl')).toBe(true);
    // width/height required via the display-controller include.
    expect(b.required.has('width')).toBe(true);
    expect(b.required.has('height')).toBe(true);
    // The sitronix chain does NOT include lcd-controller.
    expect(b.requiresPixelFormat).toBe(false);
  });

  it('detects the lcd-controller family (pixel-format becomes required)', () => {
    const b = readDisplayBindingFrom('ilitek,ili9341', FIXTURES)!;
    expect(b.requiresPixelFormat).toBe(true);
    // The `- name: x.yaml` include form with a property-blocklist resolves.
    expect(b.required.has('mipi-max-frequency')).toBe(true);
  });

  it('resolves includes from sibling binding subdirectories', () => {
    const b = readDisplayBindingFrom('goodix,gt911', FIXTURES)!;
    expect(b.required.has('reg')).toBe(true);
  });

  it('returns undefined for unknown compatibles', () => {
    expect(readDisplayBindingFrom('acme,nope', FIXTURES)).toBeUndefined();
  });

  it('lists panel compatibles from the display bindings directory only', () => {
    __setDisplayBindingRootOverride(FIXTURES);
    const compatibles = listBoundDisplayCompatibles();
    expect(compatibles).toContain('sitronix,st7796s');
    expect(compatibles).toContain('ilitek,ili9341');
    // The gt911 binding lives in i2c/ — not a panel.
    expect(compatibles).not.toContain('goodix,gt911');
  });
});
