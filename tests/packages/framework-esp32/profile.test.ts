import { describe, it, expect } from 'vitest';
import { chipForTarget } from '../../../packages/framework-esp32/src/chips/index';

describe('chipForTarget', () => {
  it('routes classic esp32', () => {
    expect(chipForTarget('esp32').id).toBe('esp32');
  });
  it('routes esp32s3', () => {
    expect(chipForTarget('esp32s3').id).toBe('esp32s3');
  });
  it('routes esp32c3', () => {
    expect(chipForTarget('esp32c3').id).toBe('esp32c3');
  });
  it('routes esp32c6', () => {
    expect(chipForTarget('esp32c6').id).toBe('esp32c6');
  });
  it('defaults to classic esp32 on undefined target', () => {
    expect(chipForTarget(undefined).id).toBe('esp32');
  });
  it('defaults to classic esp32 on unknown target', () => {
    expect(chipForTarget('esp32s2').id).toBe('esp32');
  });
  it('normalizes Arduino FQBN to chip id', () => {
    expect(chipForTarget('esp32:esp32:esp32s3').id).toBe('esp32s3');
    expect(chipForTarget('esp32:esp32:esp32c3').id).toBe('esp32c3');
  });
});
