import type { SecurityBoundaryId, ServiceId } from "./ids.js";

export type TrustLevel = "untrusted" | "authenticated" | "trusted-internal" | "privileged";

/**
 * A named perimeter between trust levels (e.g. "public internet" -> "authenticated API" ->
 * "payment service"). Architecture rules (Section 16) are expressed as allow/deny edges
 * between security boundaries and services.
 */
export interface SecurityBoundary {
  readonly id: SecurityBoundaryId;
  readonly name: string;
  readonly trustLevel: TrustLevel;
  readonly memberServiceIds: readonly ServiceId[];
}
