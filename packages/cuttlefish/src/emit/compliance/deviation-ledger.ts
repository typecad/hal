import type { Deviation } from "./types.js";

/** Input shape for recording a deviation (line + endLine derived from context). */
export interface DeviationInput {
  ruleId: string;
  file: "source" | "header";
  line: number;
  snippet: string;
  justification: string;
  source?: Deviation["source"];
}

interface OpenRegion extends DeviationInput {
  // opened at .line; closed when closeRegion(endLine) is called
}

/**
 * Append-only store of deviations recorded during emit. Dedupes identical
 * (ruleId, file, line) entries; supports region deviations via openRegion /
 * closeRegion. The ledger is the single source of truth that the sidecar
 * registry is rendered from.
 */
export class DeviationLedger {
  private readonly entries: Deviation[] = [];
  private openRegionEntry: OpenRegion | null = null;

  record(input: DeviationInput): void {
    if (this.openRegionEntry) {
      throw new Error(
        `Cannot record single-line deviation for ${input.ruleId} while a region is open for ${this.openRegionEntry.ruleId}.`,
      );
    }
    const endLine = input.line;
    this.append({ ...input, endLine, reviewStatus: "auto-generated" });
  }

  openRegion(input: DeviationInput): void {
    if (this.openRegionEntry) {
      throw new Error(
        `Cannot open deviation region for ${input.ruleId}: a region is already open for ${this.openRegionEntry.ruleId}.`,
      );
    }
    this.openRegionEntry = { ...input };
  }

  closeRegion(endLine: number): void {
    if (!this.openRegionEntry) {
      throw new Error("Cannot close a deviation region: no open deviation region.");
    }
    if (endLine < this.openRegionEntry.line) {
      throw new Error(
        `closeRegion endLine ${endLine} is before the region start line ${this.openRegionEntry.line}.`,
      );
    }
    this.append({ ...this.openRegionEntry, endLine, reviewStatus: "auto-generated" });
    this.openRegionEntry = null;
  }

  all(): readonly Deviation[] {
    return this.entries;
  }

  /** Used by the self-check to verify every ledger entry has a matching inline comment. */
  hasEntry(file: "source" | "header", line: number, ruleId: string): boolean {
    return this.entries.some(
      (e) => e.file === file && line >= e.line && line <= e.endLine && e.ruleId === ruleId,
    );
  }

  private append(entry: Deviation): void {
    const dup = this.entries.some(
      (e) => e.ruleId === entry.ruleId && e.file === entry.file && e.line === entry.line,
    );
    if (!dup) this.entries.push(entry);
  }
}
