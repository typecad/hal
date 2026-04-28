# TypeHAL Debugger

Breakpoint-based debugging for TypeHAL embedded projects using VS Code integration and serial output.

## Overview

The TypeHAL debugger lets you set breakpoints in your TypeScript source and debug directly on the embedded device. When a breakpoint is hit, the device:

1. Prints the breakpoint location and source line
2. Displays all variables in scope
3. Waits for you to press ENTER to continue

## Quick Start

### 1. Set Breakpoints

In VS Code, place your cursor on a line and run the command:

```
TypeHAL: Toggle Breakpoint
```

Or use the standard VS Code breakpoint gutter (red circle).

### 2. Compile & Upload with Debug

```bash
npx typehal sketch.ts --compile --upload --port COM4 --debug
```

### 3. Monitor Serial Output

```bash
npx typehal sketch.ts --monitor --port COM4
```

Or use any serial monitor at **9600 baud**.

## Example Output

When a breakpoint is hit, you'll see:

```
🔧 TypeHAL Debug Mode Active

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏸️  BREAKPOINT: example.ts:10
  counter++;

  Variables:
  • square = [function]
  • counter = 0

  [Press ENTER to continue...]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Press ENTER in the serial monitor to continue to the next breakpoint.

## CLI Flags

| Flag | Description |
|------|-------------|
| `--debug` | Enable debug mode (injects breakpoint instrumentation) |
| `--monitor` | Open serial monitor (9600 baud) |

## Breakpoint Types

### Regular Breakpoints
Stop execution and display variables. Press ENTER to continue.

### Conditional Breakpoints
Only break when a condition is true. In VS Code, right-click the gutter and select "Add Conditional Breakpoint", then enter an expression like:
```
counter > 5
```

The breakpoint will only trigger when `counter` exceeds 5.

**Condition Normalization:**

TypeScript conditions are automatically normalized for C++ compatibility:

| TypeScript | C++ (generated) |
|------------|-----------------|
| `===` | `==` |
| `!==` | `!=` |
| trailing `;` | (removed) |

For example, a condition of `counter === 10;` becomes `counter == 10` in the generated code.

### Logpoints
Log a message without stopping execution. In VS Code, right-click the gutter and select "Add Logpoint", then enter a message with `{variable}` interpolation:
```
Loop iteration {i}, sensor = {sensor.read()}
```

Output:
```
[LOG sketch.ts:15] Loop iteration 42, sensor = 847
```

## VS Code Extension

The `vscode-typehal-debug` extension provides:

### Commands

| Command | Description |
|---------|-------------|
| `typehal-debug.toggleBreakpoint` | Toggle breakpoint at cursor |
| `typehal-debug.clearAllBreakpoints` | Remove all breakpoints |
| `typehal-debug.debugWithBreakpoints` | Build and debug with breakpoints |

### Breakpoint Storage

Breakpoints are stored in `.typehal/breakpoints.json`:

```json
{
  "breakpoints": [
    { "file": "sketch.ts", "line": 10 },
    { "file": "sketch.ts", "line": 25, "condition": "counter > 5" },
    { "file": "sketch.ts", "line": 40, "logMessage": "Loop {i}" }
  ]
}
```

### Breakpoint Properties

| Property | Type | Description |
|----------|------|-------------|
| `file` | string | Absolute path to the TypeScript file |
| `line` | number | Line number (1-indexed) |
| `condition` | string? | Optional condition expression |
| `logMessage` | string? | Optional logpoint message with `{var}` interpolation |

### VS Code Integration

The extension automatically syncs with VS Code's native breakpoint system:

1. **Native breakpoints**: Set breakpoints using VS Code's gutter (red circle)
2. **Conditional breakpoints**: Right-click → "Add Conditional Breakpoint"
3. **Logpoints**: Right-click → "Add Logpoint"
4. **Auto-sync**: Breakpoints sync to `.typehal/breakpoints.json` when:
   - A breakpoint is added/removed
   - A file is saved
   - The active editor changes

## How It Works

### Transpile-Time Instrumentation

When you compile with `--debug`, the transpiler:

1. Loads breakpoints from `.typehal/breakpoints.json`
2. Injects `Serial.begin(9600)` at the start of your code
3. At each breakpoint line, injects:
   - Serial prints for location, source line, and variables
   - Blocking wait for serial input (ENTER to continue)

### Generated Code Example

**TypeScript source:**
```typescript
let counter = 0;
while (true) {
  counter++;        // Breakpoint on this line
  LED.toggle();
  delay(500);
}
```

**Generated C++ (with debug):**
```cpp
void setup() {
  Serial.begin(9600);
  while (!Serial) { delay(10); }
  Serial.println("🔧 TypeHAL Debug Mode Active");
  
  int counter = 0;
  while (true) {
    // === BREAKPOINT: sketch.ts:3 ===
    Serial.println("⏸️  BREAKPOINT: sketch.ts:3");
    Serial.println("  counter++;");
    Serial.println("  Variables:");
    Serial.print("  • counter = "); Serial.println(counter);
    Serial.println("  [Press ENTER to continue...]");
    while(Serial.available() == 0) { delay(10); }
    while(Serial.available() > 0) { Serial.read(); delay(10); }
    // === END BREAKPOINT ===
    counter++;
    digitalWrite(13, !digitalRead(13));
    delay(500);
  }
}
```

## Variable Scope

The debugger captures variables in scope at each breakpoint:

- **Top-level variables**: All module-level `let`/`const` declarations
- **Function parameters**: Parameters of the enclosing function
- **Local variables**: Variables declared inside functions

Functions are displayed as `[function]` since their value cannot be printed.

## Limitations

- **Serial required**: Debug mode requires a serial connection (USB)
- **Blocking**: Execution stops at each breakpoint until ENTER is pressed (logpoints don't block)
- **No step-through**: You can only continue to the next breakpoint, not step line-by-line
- **Baud rate fixed at 9600**: Must match in your serial monitor

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  VS Code Extension                           │
│  Tracks breakpoints → .typehal/breakpoints.json            │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               CLI with --debug flag                         │
│  Loads breakpoints → Injects Serial debug code              │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Transpiler                                │
│  packages/cli/src/debug/preprocessor.ts                     │
│  - AST-based breakpoint injection                           │
│  - Scope analysis for variable capture                      │
│  - Serial.println() code generation                         │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               Generated Arduino Sketch                       │
│  Serial.begin(9600) + breakpoint instrumentation            │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Target Board                              │
│  Executes with serial debug output                          │
└─────────────────────────────────────────────────────────────┘
```

## Files

| File | Description |
|------|-------------|
| `packages/cli/src/debug/types.ts` | Breakpoint type definitions |
| `packages/cli/src/debug/breakpoint-loader.ts` | Load breakpoints from JSON |
| `packages/cli/src/debug/preprocessor.ts` | AST transform for debug injection |
| `vscode-typehal-debug/src/extension.ts` | VS Code extension |

---

## VS Code Extension Development

### Extension Structure

```
vscode-typehal-debug/
├── package.json           # Extension manifest and contributions
├── tsconfig.json          # TypeScript configuration
├── src/
│   └── extension.ts       # Main extension code
└── *.vsix                 # Packaged extension
```

### Adding New Commands

1. **Register in `package.json`** under `contributes.commands`:

```json
{
  "contributes": {
    "commands": [
      {
        "command": "typehal-debug.myNewCommand",
        "title": "TypeHAL: My New Command"
      }
    ]
  }
}
```

2. **Implement in `extension.ts`**:

```typescript
const myCmd = vscode.commands.registerCommand(
  'typehal-debug.myNewCommand',
  () => {
    // Your implementation
    vscode.window.showInformationMessage('Command executed!');
  }
);

context.subscriptions.push(myCmd);
```

### Adding Keybindings

In `package.json` under `contributes.keybindings`:

```json
{
  "contributes": {
    "keybindings": [
      {
        "command": "typehal-debug.toggleBreakpoint",
        "key": "f9",
        "when": "editorTextFocus"
      }
    ]
  }
}
```

### Adding a Serial Monitor Panel

To add an integrated serial monitor, create a custom panel:

```typescript
import * as vscode from 'vscode';
import { SerialPort } from 'serialport';

class SerialMonitorPanel {
  public static currentPanel: SerialMonitorPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _serial: SerialPort | undefined;

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    const panel = vscode.window.createWebviewPanel(
      'typehalSerialMonitor',
      'TypeHAL Serial Monitor',
      column || vscode.ViewColumn.One,
      {}
    );

    SerialMonitorPanel.currentPanel = new SerialMonitorPanel(panel, extensionUri);
  }

  async connect(port: string, baudRate: number) {
    this._serial = new SerialPort({ path: port, baudRate });
    this._serial.on('data', (data) => {
      // Send to webview
      this._panel.webview.postMessage({ type: 'data', data: data.toString() });
    });
  }
}
```

### Adding Status Bar Items

```typescript
const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
statusBarItem.text = '$(debug-breakpoint) 3 breakpoints';
statusBarItem.show();
context.subscriptions.push(statusBarItem);
```

---

## Packaging for Distribution

### Prerequisites

```bash
npm install -g @vscode/vsce
```

### Build the Extension

```bash
cd vscode-typehal-debug
npm install
npm run compile  # or: npx tsc
```

### Package as VSIX

```bash
vsce package
```

This creates `vscode-typehal-debug-0.1.0.vsix`.

### Install Locally for Testing

In VS Code:
1. Open Command Palette (Ctrl+Shift+P)
2. Run "Extensions: Install from VSIX..."
3. Select the `.vsix` file

Or via CLI:
```bash
code --install-extension vscode-typehal-debug-0.1.0.vsix
```

### Publish to Marketplace

1. Create a [Personal Access Token](https://dev.azure.com) for Azure DevOps
2. Login to VS Code marketplace:

```bash
vsce login <your-publisher-id>
```

3. Publish:

```bash
vsce publish
```

For updates, bump the version in `package.json` and run:

```bash
vsce publish patch  # 0.1.0 → 0.1.1
vsce publish minor  # 0.1.0 → 0.2.0
vsce publish major  # 0.1.0 → 1.0.0
```

### package.json Required Fields

Ensure these fields are set for publishing:

```json
{
  "name": "vscode-typehal-debug",
  "displayName": "TypeHAL Debug",
  "version": "0.1.0",
  "publisher": "<your-publisher-id>",
  "description": "Breakpoint-based debugging for TypeHAL embedded projects",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Debuggers", "Other"],
  "activationEvents": ["onLanguage:typescript"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [...]
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/your-repo/typehal"
  }
}
```
