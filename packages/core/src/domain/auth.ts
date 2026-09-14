import type { SourceLocation, SymbolId } from "./ids.js";

/**
 * Placeholder authentication/authorization contracts referenced by EndpointModel (Section 8/9/10).
 * These are intentionally minimal in Phase 0 — they establish the shape that the security engine
 * (Phase 5+, Section 8/9) will populate. Do not add analysis logic here.
 */

export type AuthenticationMechanismKind = "session" | "jwt" | "oauth" | "api-key" | "basic" | "custom" | "none";

export interface AuthenticationModel {
  readonly mechanism: AuthenticationMechanismKind;
  readonly enforcedBy: readonly SymbolId[];
  readonly location?: SourceLocation;
}

export interface AuthorizationModel {
  readonly requiredRoles: readonly string[];
  readonly requiredPermissions: readonly string[];
  readonly ownershipChecked?: boolean;
  readonly enforcedBy: readonly SymbolId[];
  readonly location?: SourceLocation;
}
