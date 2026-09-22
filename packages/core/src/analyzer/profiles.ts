import type { ScanProfile } from "../domain/scan.js";
import type { AnalyzerCategory } from "./analyzer.js";

/**
 * Which `AnalyzerCategory` values a `ScanProfile` runs (ADR-0013). Categories with no shipped
 * analyzer yet (`security`, `performance`, `dependency`, `infrastructure`) are still listed under
 * `full`/`enterprise` so registering an analyzer in one of those categories later needs no change
 * here — it starts running under the profiles that already claim to cover it.
 */
export const PROFILE_CATEGORIES: Readonly<Record<ScanProfile, readonly AnalyzerCategory[]>> = {
  minimal: ["architecture"],
  standard: ["architecture", "quality"],
  security: ["security", "secrets"],
  full: ["architecture", "quality", "security", "secrets", "dependency", "performance", "infrastructure"],
  enterprise: ["architecture", "quality", "security", "secrets", "dependency", "performance", "infrastructure"],
};
