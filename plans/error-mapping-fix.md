# CLI Error Mapping Fix Implementation Plan

## Problem Analysis

The CLI error mapping feature exists but fails during compilation because:

1. **Source map path mismatch**: When `--compile` is used, the generated .ino file is different from the original .ts file
2. **Flattening breaks mapping**: The `flattenGeneratedModulesIntoSketch` function merges multiple .cpp files into one .ino, but the source map still points to the original .ts file
3. **Path resolution issues**: The `resolveMapPath` function doesn't handle the flattened sketch scenario

## Root Cause

In `packages/cli/src/cli.ts`, line 145-146:
```typescript
const compileResult = compileArduinoSketch(result.sourcePath, fqbn);
printMappedCompileErrors(compileResult, result.sourceMapPath);
```

The `result.sourceMapPath` points to the original .ts file, but `compileArduinoSketch` works with the flattened .ino file, causing a mismatch.

## Solution Architecture

### 1. Enhanced Source Map Generation
- Modify the emitter to generate source maps that account for flattening
- Add offset tracking for merged files
- Create a composite source map for the final .ino file

### 2. Improved Error Parsing
- Enhance the GCC-style error regex to handle more Arduino CLI error formats
- Add better line/column extraction
- Handle relative vs absolute paths correctly

### 3. Smart Path Resolution
- Detect when flattening occurs
- Generate appropriate source map paths for flattened sketches
- Fall back gracefully when mapping fails

### 4. Automatic Integration
- Make error mapping work seamlessly with `--compile`
- Provide clear fallback messages when mapping isn't possible
- Maintain backward compatibility with manual `map-error` command

## Implementation Steps

### Step 1: Fix Source Map Generation for Flattened Sketches

**File**: `packages/cli/src/emit/cpp-emitter.ts`

1. Add a function to generate composite source maps for flattened sketches
2. Track file offsets when merging .cpp files into .ino
3. Update the `emitCpp` function to handle flattened scenarios

### Step 2: Enhance Error Parsing

**File**: `packages/cli/src/platform/arduino-compile.ts`

1. Improve the `parseCompileErrors` function with more robust regex patterns
2. Handle different Arduino CLI error formats
3. Add better path normalization

### Step 3: Smart Path Resolution

**File**: `packages/cli/src/mapping/source-map.ts`

1. Add a function to resolve source maps for flattened sketches
2. Detect when the generated file has been flattened
3. Provide fallback mapping strategies

### Step 4: Update CLI Integration

**File**: `packages/cli/src/cli.ts`

1. Modify `printMappedCompileErrors` to handle flattened sketches
2. Add automatic detection of flattening scenarios
3. Improve error messages and fallback behavior

### Step 5: Testing and Validation

1. Create test cases for various error scenarios
2. Test with different board types and FQBNs
3. Validate that TypeScript line numbers are correctly mapped

## Key Functions to Implement

### 1. Composite Source Map Generation
```typescript
function generateCompositeSourceMap(
  flattenedSketchPath: string,
  originalSourcePath: string,
  moduleSourceMaps: Map<string, GeneratedSourceMap>
): GeneratedSourceMap
```

### 2. Enhanced Error Parsing
```typescript
function parseCompileErrors(output: string, sketchDir: string): ArduinoCompileError[]
```

### 3. Smart Path Resolution
```typescript
function resolveSourceMapForSketch(
  sketchPath: string,
  originalSourceMapPath?: string
): string | undefined
```

## Expected Outcome

After implementation:
- `npx typecode ./example.ts --compile` will automatically map C++ errors back to TypeScript source
- Error messages will show: `example.ts(42,5): error: ...` instead of `example.ino(123,10): error: ...`
- Fallback to raw C++ errors when mapping fails
- Full backward compatibility with existing `map-error` command

## Testing Strategy

1. **Unit Tests**: Test each function individually
2. **Integration Tests**: Test the full compilation pipeline
3. **Error Scenarios**: Test various types of compilation errors
4. **Board Compatibility**: Test with different Arduino boards and FQBNs

## Files to Modify

1. `packages/cli/src/emit/cpp-emitter.ts` - Source map generation
2. `packages/cli/src/platform/arduino-compile.ts` - Error parsing
3. `packages/cli/src/mapping/source-map.ts` - Path resolution
4. `packages/cli/src/cli.ts` - CLI integration
5. Add test files for validation

This fix will make the error mapping feature work automatically and seamlessly for users, significantly improving the debugging experience.