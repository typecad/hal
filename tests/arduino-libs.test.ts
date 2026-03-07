// ---------------------------------------------------------------------------
// Arduino Library Integration Tests
//
// Tests for Arduino library discovery, type definition generation, and
// namespace handling
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isArduinoLibraryImport,
  mapCppTypeToTs,
  parseParameters,
  parseCppClass,
  generateUsageDocumentation,
  clearLibraryCache,
  type ArduinoLibrary,
} from '../packages/cli/src/arduino-libs';

// Mock Arduino library for testing
const mockLibrary: ArduinoLibrary = {
  name: 'TestSensor',
  version: '1.0.0',
  path: '/mock/path/TestSensor',
  author: 'Test Author',
  sentence: 'A test sensor library',
};

describe('Arduino Library Import Detection', () => {
  it('identifies Arduino library imports', () => {
    expect(isArduinoLibraryImport('BH1750')).toBe(true);
    expect(isArduinoLibraryImport('Servo')).toBe(true);
    expect(isArduinoLibraryImport('Wire')).toBe(true);
    expect(isArduinoLibraryImport('Microfire_SHT3x')).toBe(true);
  });

  it('rejects non-Arduino library imports', () => {
    // Relative imports
    expect(isArduinoLibraryImport('./local-module')).toBe(false);
    expect(isArduinoLibraryImport('../parent-module')).toBe(false);
    
    // NPM-style imports
    expect(isArduinoLibraryImport('@typecode/core')).toBe(false);
    expect(isArduinoLibraryImport('typescript')).toBe(false);
    expect(isArduinoLibraryImport('node/fs')).toBe(false);
    
    // Known non-Arduino imports
    expect(isArduinoLibraryImport('fs')).toBe(false);
    expect(isArduinoLibraryImport('path')).toBe(false);
    expect(isArduinoLibraryImport('http')).toBe(false);
  });
});

describe('C++ to TypeScript Type Mapping', () => {
  it('maps I2C peripheral types', () => {
    expect(mapCppTypeToTs('TwoWire')).toBe('I2C0');
    expect(mapCppTypeToTs('TwoWire*')).toBe('I2C0');
    expect(mapCppTypeToTs('TwoWire&')).toBe('I2C0');
  });

  it('maps SPI peripheral types', () => {
    expect(mapCppTypeToTs('SPIClass')).toBe('SPI0');
    expect(mapCppTypeToTs('SPIClass*')).toBe('SPI0');
    expect(mapCppTypeToTs('SPIClass&')).toBe('SPI0');
  });

  it('maps Serial peripheral types', () => {
    expect(mapCppTypeToTs('HardwareSerial')).toBe('UART0');
    expect(mapCppTypeToTs('HardwareSerial*')).toBe('UART0');
    expect(mapCppTypeToTs('Stream')).toBe('UART0');
    expect(mapCppTypeToTs('Stream*')).toBe('UART0');
  });

  it('maps integer types', () => {
    expect(mapCppTypeToTs('int')).toBe('number');
    expect(mapCppTypeToTs('uint8_t')).toBe('number');
    expect(mapCppTypeToTs('uint16_t')).toBe('number');
    expect(mapCppTypeToTs('int32_t')).toBe('number');
    expect(mapCppTypeToTs('byte')).toBe('number');
    expect(mapCppTypeToTs('size_t')).toBe('number');
  });

  it('maps floating point types', () => {
    expect(mapCppTypeToTs('float')).toBe('number');
    expect(mapCppTypeToTs('double')).toBe('number');
  });

  it('maps boolean type', () => {
    expect(mapCppTypeToTs('bool')).toBe('boolean');
  });

  it('maps string types', () => {
    expect(mapCppTypeToTs('char*')).toBe('string');
    expect(mapCppTypeToTs('const char*')).toBe('string');
    expect(mapCppTypeToTs('String')).toBe('string');
    expect(mapCppTypeToTs('std::string')).toBe('string');
  });

  it('handles const qualifiers', () => {
    expect(mapCppTypeToTs('const int')).toBe('number');
    expect(mapCppTypeToTs('const char*')).toBe('string');
  });

  it('returns any for unknown types', () => {
    expect(mapCppTypeToTs('CustomType')).toBe('any');
    expect(mapCppTypeToTs('UnknownClass')).toBe('any');
  });
});

describe('Parameter Parsing', () => {
  it('parses empty parameter list', () => {
    const params = parseParameters('');
    expect(params).toEqual([]);
  });

  it('parses single parameter', () => {
    const params = parseParameters('int value');
    expect(params).toHaveLength(1);
    expect(params[0].type).toBe('number');
    expect(params[0].name).toBe('value');
  });

  it('parses multiple parameters', () => {
    const params = parseParameters('int a, float b, bool c');
    expect(params).toHaveLength(3);
    expect(params[0].type).toBe('number');
    expect(params[0].name).toBe('a');
    expect(params[1].type).toBe('number');
    expect(params[1].name).toBe('b');
    expect(params[2].type).toBe('boolean');
    expect(params[2].name).toBe('c');
  });

  it('parses TwoWire pointer parameter', () => {
    const params = parseParameters('TwoWire* wire');
    expect(params).toHaveLength(1);
    expect(params[0].type).toBe('I2C0');
    expect(params[0].name).toBe('wire');
  });

  it('strips & prefix from parameter names', () => {
    const params = parseParameters('int& value');
    expect(params).toHaveLength(1);
    // The & should be moved to the type or handled
    expect(params[0].name).toBe('value');
  });

  it('strips * prefix from parameter names', () => {
    const params = parseParameters('int* ptr');
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('ptr');
  });

  it('ignores default values', () => {
    const params = parseParameters('int value = 10');
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('value');
  });
});

describe('C++ Class Parsing', () => {
  it('parses simple class without namespace', () => {
    const content = `
      class BH1750 {
      public:
        BH1750(byte addr = 0x23);
        bool begin();
        float readLightLevel();
      };
    `;
    
    const result = parseCppClass(content);
    
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe('BH1750');
    expect(result.classes[0].fullName).toBe('BH1750');
    expect(result.classes[0].namespace).toBeUndefined();
  });

  it('parses class with namespace', () => {
    const content = `
      namespace Microfire {
        class SHT3x {
        public:
          bool begin(TwoWire* wirePort, uint8_t address);
          float measure();
        };
      }
    `;
    
    const result = parseCppClass(content);
    
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe('SHT3x');
    expect(result.classes[0].fullName).toBe('Microfire::SHT3x');
    expect(result.classes[0].namespace).toBe('Microfire');
  });

  it('parses constructor from implementation file', () => {
    // Constructors in .cpp files use scope resolution (ClassName::ClassName)
    const content = `
      Sensor::Sensor(int pin) {
        _pin = pin;
      }
      
      Sensor::Sensor(int pin, float threshold) {
        _pin = pin;
        _threshold = threshold;
      }
    `;
    
    const result = parseCppClass(content);
    
    // Should find the Sensor class from scope resolution
    expect(result.classes.length).toBeGreaterThanOrEqual(1);
    const sensorClass = result.classes.find(c => c.name === 'Sensor');
    expect(sensorClass).toBeDefined();
    expect(sensorClass!.constructors).toHaveLength(2);
  });

  it('parses method signatures', () => {
    const content = `
      class Sensor {
      public:
        bool begin();
        int read();
        void reset();
      };
    `;
    
    const result = parseCppClass(content);
    
    const methodNames = result.classes[0].methods.map(m => m.name);
    expect(methodNames).toContain('begin');
    expect(methodNames).toContain('read');
    expect(methodNames).toContain('reset');
  });

  it('parses constants', () => {
    const content = `
      const int DEFAULT_ADDRESS = 0x23;
      const float VERSION = 1.0;
    `;
    
    const result = parseCppClass(content);
    
    expect(result.constants).toHaveLength(2);
    expect(result.constants[0].name).toBe('DEFAULT_ADDRESS');
    expect(result.constants[1].name).toBe('VERSION');
  });
});

describe('Usage Documentation Generation', () => {
  it('generates documentation with library info', () => {
    const parsed = {
      classes: [{
        name: 'TestSensor',
        fullName: 'TestSensor',
        methods: [],
        constructors: [],
      }],
      constants: [],
    };
    
    const doc = generateUsageDocumentation(parsed, 'TestSensor', mockLibrary);
    
    expect(doc).toContain('# TestSensor - TypeCode Usage Guide');
    expect(doc).toContain('Test Author');
    expect(doc).toContain('A test sensor library');
  });

  it('includes namespace information', () => {
    const parsed = {
      classes: [{
        name: 'SHT3x',
        fullName: 'Microfire::SHT3x',
        namespace: 'Microfire',
        methods: [],
        constructors: [],
      }],
      constants: [],
    };
    
    const doc = generateUsageDocumentation(parsed, 'Microfire_SHT3x');
    
    expect(doc).toContain('**C++:** `Microfire::SHT3x`');
  });

  it('generates method table', () => {
    const parsed = {
      classes: [{
        name: 'Sensor',
        fullName: 'Sensor',
        methods: [
          { name: 'begin', returnType: 'boolean', parameters: [], isPublic: true },
          { name: 'read', returnType: 'number', parameters: [{ type: 'number', name: 'channel' }], isPublic: true },
        ],
        constructors: [],
      }],
      constants: [],
    };
    
    const doc = generateUsageDocumentation(parsed, 'Sensor');
    
    expect(doc).toContain('| Method | Parameters | Returns |');
    expect(doc).toContain('`begin()`');
    expect(doc).toContain('`read()`');
  });

  it('generates constructor examples', () => {
    const parsed = {
      classes: [{
        name: 'Sensor',
        fullName: 'Sensor',
        methods: [],
        constructors: [
          { parameters: [{ type: 'number', name: 'address' }] },
        ],
      }],
      constants: [],
    };
    
    const doc = generateUsageDocumentation(parsed, 'Sensor');
    
    expect(doc).toContain('const sensor = new Sensor(address: number)');
  });

  it('includes type mappings section', () => {
    const parsed = { classes: [], constants: [] };
    const doc = generateUsageDocumentation(parsed, 'TestLib');
    
    expect(doc).toContain('## Type Mappings');
    expect(doc).toContain('TwoWire');
    expect(doc).toContain('I2C0');
  });

  it('includes peripheral imports when needed', () => {
    const parsed = {
      classes: [{
        name: 'Sensor',
        fullName: 'Sensor',
        methods: [
          { name: 'begin', returnType: 'boolean', parameters: [{ type: 'I2C0', name: 'wire' }], isPublic: true },
        ],
        constructors: [],
      }],
      constants: [],
    };
    
    const doc = generateUsageDocumentation(parsed, 'Sensor');
    
    expect(doc).toContain("import { I2C0 } from '@typecode'");
  });

  it('includes editing instructions', () => {
    const parsed = { classes: [], constants: [] };
    const doc = generateUsageDocumentation(parsed, 'TestLib');
    
    expect(doc).toContain('## Editing Type Definitions');
    expect(doc).toContain('node_modules/@types/TestLib/index.d.ts');
  });
});

describe('Multiple Classes', () => {
  it('parses multiple classes in same content', () => {
    const content = `
      class Sensor {
      public:
        float read();
      };
      
      class Actuator {
      public:
        void write(int value);
      };
    `;
    
    const result = parseCppClass(content);
    
    expect(result.classes.length).toBeGreaterThanOrEqual(2);
    const classNames = result.classes.map(c => c.name);
    expect(classNames).toContain('Sensor');
    expect(classNames).toContain('Actuator');
  });
});