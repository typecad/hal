// Stub — real idf.py toolchain added in Task 3.
export const Toolchain = {
  prepare(_outputDir: string, _entryPoint: string): void { /* no-op until Task 3 */ },
  compile(_o: any): any { throw new Error('framework-esp32 toolchain not yet implemented (Task 3)'); },
  upload(_o: any): any { throw new Error('framework-esp32 toolchain not yet implemented (Task 3)'); },
  monitor(_o: any): void { throw new Error('framework-esp32 toolchain not yet implemented (Task 3)'); },
};
