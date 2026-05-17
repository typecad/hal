import { describe, expect, it } from 'vitest';
import { matchConnectedPins, type ContractData } from '../../../packages/transpiler/src/contract-parser';

describe('contract-parser', () => {
  describe('matchConnectedPins', () => {
    it('should correctly match simple pin names', () => {
      const contract: ContractData = {
        mcu: { symbol: 'test_mcu' },
        connectedPins: {
          '1': { pinName: 'PB5', pinType: 'io', net: 'net1' },
          '2': { pinName: 'PC4', pinType: 'io', net: 'net2' },
        }
      };

      const mcuPinNames = ['PB5', 'PC4', 'PD2', 'LED'];
      const matches = matchConnectedPins(contract, mcuPinNames);
      
      expect(matches).toHaveLength(2);
      expect(matches).toContain('PB5');
      expect(matches).toContain('PC4');
    });

    it('should correctly match compound pin names', () => {
      const contract: ContractData = {
        mcu: { symbol: 'test_mcu' },
        connectedPins: {
          '3': { pinName: 'XTAL1/PB6', pinType: 'io', net: 'net3' },
          '4': { pinName: 'ADC4/PC4', pinType: 'io', net: 'net4' },
          '5': { pinName: 'VCC', pinType: 'power', net: 'net5' },
        }
      };

      const mcuPinNames = ['PB6', 'PC4', 'PD2'];
      const matches = matchConnectedPins(contract, mcuPinNames);
      
      expect(matches).toHaveLength(2);
      expect(matches).toContain('PB6');
      expect(matches).toContain('PC4');
    });

    it('should filter out duplicate matches', () => {
      const contract: ContractData = {
        mcu: { symbol: 'test_mcu' },
        connectedPins: {
          '1': { pinName: 'PB5', pinType: 'io', net: 'net1' },
          '2': { pinName: 'PB5_ALT', pinType: 'io', net: 'net2' },
        }
      };

      const mcuPinNames = ['PB5', 'PC4'];
      const matches = matchConnectedPins(contract, mcuPinNames);
      
      expect(matches).toHaveLength(1);
      expect(matches).toContain('PB5');
    });

    it('should return empty array when no matches are found', () => {
      const contract: ContractData = {
        mcu: { symbol: 'test_mcu' },
        connectedPins: {
          '1': { pinName: 'VCC', pinType: 'power', net: 'net1' },
          '2': { pinName: 'GND', pinType: 'power', net: 'net2' },
        }
      };

      const mcuPinNames = ['PB5', 'PC4'];
      const matches = matchConnectedPins(contract, mcuPinNames);
      
      expect(matches).toHaveLength(0);
    });
  });
});
