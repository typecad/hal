# Polyfill Plugin System

The Polyfill Plugin System provides an extensibility mechanism for adding custom runtime polyfills to the TypeHAL transpiler. This allows third-party libraries and board packages to extend TypeScript language support without modifying the core transpiler.

## Overview

Polyfills bridge the gap between TypeScript language features and embedded C++ runtime limitations. The plugin system allows you to:

- Add support for TypeScript/JavaScript APIs not built into the transpiler
- Provide platform-specific implementations of standard functions
- Create custom runtime helpers for specific hardware

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PolyfillRegistry                          │
│  ┌──────────────────┐  ┌──────────────────────────────────┐│
│  │ Built-in Polyfills│  │     Plugin Polyfills             ││
│  │ - console         │  │  ┌─────────┐ ┌─────────────────┐ ││
│  │ - async/await     │  │  │ Plugin A│ │ Plugin B        │ ││
│  │ - array methods   │  │  │ - touch │ │ - custom serial │ ││
│  │ - string methods  │  │  │ - wifi  │ │ - sensor utils  │ ││
│  └──────────────────┘  │  └─────────┘ └─────────────────┘ ││
│                        └──────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Program IR                              │
│  (Intermediate Representation of transpiled code)            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Polyfill Detection                        │
│  (Analyze IR to determine which polyfills are needed)        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Polyfill Generation                       │
│  (Generate C++ code for required polyfills)                  │
└─────────────────────────────────────────────────────────────┘
```

## Plugin Interface

A polyfill plugin implements the `PolyfillPlugin` interface:

```typescript
interface PolyfillPlugin {
  /** Unique plugin identifier (e.g., "@myorg/polyfill-touch") */
  id: string;

  /** Human-readable name */
  name: string;

  /** Plugin version (semver recommended) */
  version?: string;

  /** Description of polyfills provided */
  description?: string;

  /** Polyfill definitions */
  polyfills: PolyfillDefinition[];

  /** Optional initialization hook */
  init?(context: PluginContext): void | Promise<void>;

  /** Optional cleanup hook */
  dispose?(): void | Promise<void>;
}
```

## Creating a Plugin

### Simple Plugin

Use `createSimplePlugin()` for quick plugin creation:

```typescript
import { createSimplePlugin, PolyfillDefinition } from 'typehal/polyfill';

const myPolyfill: PolyfillDefinition = {
  id: 'custom-map',
  domains: ['standard', 'embedded'],
  
  detect: (program, context) => {
    // Return needs if Map is used in the program
    const usesMap = program.statements.some(stmt => 
      stmt.kind === 'call' && stmt.callee.includes('Map')
    );
    
    if (usesMap) {
      return [{
        kind: 'feature',
        id: 'custom-map',
        sourceSpan: { start: 0, end: 0 },
        details: { reason: 'Map usage detected' }
      }];
    }
    return [];
  },
  
  generate: (needs, context) => ({
    kind: 'runtime-polyfill',
    id: 'custom-map',
    domain: 'embedded',
    requiredIncludes: ['<Arduino.h>'],
    forwardDeclarations: [],
    globalDeclarations: [
      '// Simple Map implementation for embedded',
      'template<typename K, typename V>',
      'class Map { ... };'
    ],
    helperFunctions: [],
    staticInitializers: [],
    mainPrefix: [],
    mainSuffix: [],
  })
};

export const myPlugin = createSimplePlugin(
  '@myorg/polyfill-map',
  'Map Polyfill',
  [myPolyfill],
  { version: '1.0.0', description: 'Adds Map support for embedded' }
);
```

### Advanced Plugin with Lifecycle

```typescript
import { PolyfillPlugin, PluginContext } from 'typehal/polyfill';

export const advancedPlugin: PolyfillPlugin = {
  id: '@myorg/advanced-polyfills',
  name: 'Advanced Polyfills',
  version: '2.0.0',
  description: 'Advanced runtime polyfills for ESP32',
  
  polyfills: [
    // ... polyfill definitions
  ],
  
  init: async (context: PluginContext) => {
    context.log.info(`Initializing plugin for target: ${context.target}`);
    
    // Validate environment
    if (context.target !== 'esp32') {
      context.log.warn('This plugin is optimized for ESP32');
    }
    
    // Load configuration
    const config = context.config as MyPluginConfig;
    if (config?.debugMode) {
      context.log.debug('Debug mode enabled');
    }
  },
  
  dispose: async () => {
    // Cleanup resources
    console.log('Plugin disposed');
  }
};
```

## Polyfill Definition

Each polyfill in a plugin implements `PolyfillDefinition`:

```typescript
interface PolyfillDefinition {
  /** Unique polyfill identifier */
  id: string;
  
  /** Target domains: 'standard', 'embedded', 'arduino', etc. */
  domains: string[];
  
  /**
   * Detect if this polyfill is needed.
   * Analyzes the program IR and returns a list of needs.
   */
  detect: (program: ProgramIR, context: PolyfillContext) => PolyfillNeed[];
  
  /**
   * Generate C++ code for the polyfill.
   * Called with detected needs, returns the polyfill IR.
   */
  generate: (needs: PolyfillNeed[], context: PolyfillContext) => RuntimePolyfillIR;
}
```

### Detection

The `detect` function analyzes the program to determine if the polyfill is needed:

```typescript
detect: (program, context) => {
  const needs: PolyfillNeed[] = [];
  
  // Walk through all functions in the program
  for (const func of program.functions) {
    // Check statements for patterns
    for (const stmt of func.statements) {
      if (stmt.kind === 'call') {
        // Detect specific function calls
        if (stmt.callee === 'myCustomFunction') {
          needs.push({
            kind: 'function',
            id: 'my-custom-function',
            sourceSpan: stmt.span,
            details: { functionName: 'myCustomFunction' }
          });
        }
      }
    }
  }
  
  return needs;
}
```

### Generation

The `generate` function produces C++ code:

```typescript
generate: (needs, context) => {
  return {
    kind: 'runtime-polyfill',
    id: 'my-polyfill',
    domain: context.target,
    
    // #include directives
    requiredIncludes: [
      '<Arduino.h>',
      '"my_custom_header.h"'
    ],
    
    // Forward declarations (function prototypes, etc.)
    forwardDeclarations: [
      'void myCustomFunction();'
    ],
    
    // Global declarations (classes, structs, variables)
    globalDeclarations: [
      'static int lastResult = 0;'
    ],
    
    // Helper functions
    helperFunctions: [
      `void myCustomFunction() {
        // Implementation
        lastResult = millis();
      }`
    ],
    
    // Code to run before main()
    staticInitializers: [],
    
    // Code to insert at start of main()/setup()
    mainPrefix: [],
    
    // Code to insert at end of main()/loop()
    mainSuffix: [],
  };
}
```

## Loading Plugins

### From Code

```typescript
import { PolyfillRegistry, PluginManager } from 'typehal/polyfill';
import { myPlugin } from './my-plugin';

// Create registry with plugin
const registry = new PolyfillRegistry();
registry.registerPlugin(myPlugin);

// Or use PluginManager for more control
const manager = new PluginManager({ basePath: process.cwd() });
await manager.register(myPlugin);

// Register all plugin polyfills with registry
for (const plugin of manager.getPlugins()) {
  registry.registerPlugin(plugin);
}
```

### From Module Path

```typescript
import { loadPolyfillPlugin, PolyfillRegistry } from 'typehal/polyfill';

const registry = new PolyfillRegistry();

// Load from npm package
const result = await loadPolyfillPlugin('@myorg/polyfill-custom');
if (result.success && result.plugin) {
  registry.registerPlugin(result.plugin);
}

// Load from local file
const localResult = await loadPolyfillPlugin('./plugins/my-plugin.ts', {
  basePath: '/path/to/project'
});
```

### From Configuration

In `typehal.config.ts`:

```typescript
export default {
  // ... other config
  
  plugins: [
    '@myorg/polyfill-esp32-touch',
    './custom-plugins/sensor-helpers.ts'
  ]
}
```

## Plugin Context

The `PluginContext` provides plugins with runtime information:

```typescript
interface PluginContext {
  /** Target platform (e.g., 'arduino', 'esp32') */
  target: string;
  
  /** Configuration from typehal.config.ts */
  config: Record<string, unknown>;
  
  /** Logger for plugin messages */
  log: PluginLogger;
}

interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
```

## Built-in Polyfills

TypeHAL includes these built-in polyfills:

| Polyfill ID | Description |
|-------------|-------------|
| `console` | Console.log() support via Serial |
| `async_arduino` | Async/await for Arduino |
| `array_methods` | Array.prototype methods |
| `string_methods` | String.prototype methods |

These are always available and cannot be unloaded.

## Best Practices

### 1. Namespace Your Plugin ID

```typescript
// Good - namespaced
id: '@myorg/polyfill-esp32-wifi'

// Avoid - generic
id: 'wifi-polyfill'
```

### 2. Check Domain Compatibility

```typescript
domains: ['embedded', 'arduino']  // Works on embedded targets
domains: ['standard']              // Works everywhere (may increase code size)
```

### 3. Minimize Generated Code

Only generate what's needed:

```typescript
generate: (needs, context) => {
  // Only include functions that are actually used
  const usedFunctions = new Set(needs.map(n => n.details?.functionName));
  
  const helperFunctions = [];
  if (usedFunctions.has('funcA')) {
    helperFunctions.push('void funcA() { ... }');
  }
  if (usedFunctions.has('funcB')) {
    helperFunctions.push('void funcB() { ... }');
  }
  
  return { helperFunctions, ... };
}
```

### 4. Use Tree Shaking Compatible Patterns

```typescript
// Good - can be tree-shaken
static const int LOOKUP_TABLE[] = { 1, 2, 3 };

// Avoid - may prevent tree shaking
int globalState = 0;
```

### 5. Log Meaningful Messages

```typescript
init: (context) => {
  context.log.info(`Loaded ${context.target} optimizations`);
  
  if (someCondition) {
    context.log.warn('Feature X disabled due to memory constraints');
  }
}
```

## Example: Complete Plugin

```typescript
// @typehal/polyfill-esp32-touch/index.ts
import type { PolyfillPlugin, PolyfillDefinition, PluginContext } from 'typehal/polyfill';
import type { ProgramIR, PolyfillContext, PolyfillNeed, RuntimePolyfillIR } from 'typehal/polyfill';

const touchPolyfill: PolyfillDefinition = {
  id: 'esp32-touch',
  domains: ['esp32', 'arduino'],
  
  detect: (program: ProgramIR, context: PolyfillContext): PolyfillNeed[] => {
    const needs: PolyfillNeed[] = [];
    
    // Look for Touch.* API usage
    for (const func of program.functions) {
      for (const stmt of func.statements) {
        if (stmt.kind === 'call') {
          if (stmt.callee.startsWith('Touch.') || stmt.callee === 'touchRead') {
            needs.push({
              kind: 'feature',
              id: 'esp32-touch-read',
              sourceSpan: stmt.span || { start: 0, end: 0 },
              details: { api: stmt.callee }
            });
          }
        }
      }
    }
    
    return needs;
  },
  
  generate: (needs: PolyfillNeed[], context: PolyfillContext): RuntimePolyfillIR => {
    return {
      kind: 'runtime-polyfill',
      id: 'esp32-touch',
      domain: 'esp32',
      requiredIncludes: ['<driver/touch_pad.h>'],
      forwardDeclarations: [],
      globalDeclarations: [],
      helperFunctions: [
        `int touchRead(int pin) {
          touch_pad_t touch_num = (touch_pad_t)pin;
          uint16_t value;
          touch_pad_read(touch_num, &value);
          return (int)value;
        }`
      ],
      staticInitializers: [],
      mainPrefix: ['  touch_pad_init();'],
      mainSuffix: [],
    };
  }
};

export const esp32TouchPlugin: PolyfillPlugin = {
  id: '@typehal/polyfill-esp32-touch',
  name: 'ESP32 Touch Polyfill',
  version: '1.0.0',
  description: 'Adds touch sensor support for ESP32 boards',
  polyfills: [touchPolyfill],
  
  init: (context: PluginContext) => {
    if (!context.target.includes('esp32')) {
      context.log.warn('ESP32 Touch plugin is designed for ESP32 targets');
    }
    context.log.info('ESP32 Touch polyfill loaded');
  }
};

export default esp32TouchPlugin;
```

## See Also

- [Polyfills](./polyfills.md) - Built-in polyfill documentation
- [IR Model](./ir-model.md) - Intermediate representation
- [Language Reference](./language-reference.md) - TypeScript to C++ mapping