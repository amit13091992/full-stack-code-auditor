import type { ResultExporter, ScanResult } from "@code-analyzer/core";

/** The `ScanResult` shape is already the contract (Section 37H) — no transformation, just formatting. */
export const jsonExporter: ResultExporter = {
  format: "json",
  export(result: ScanResult): string {
    return JSON.stringify(result, null, 2);
  },
};
