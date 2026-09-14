import type { EndpointId, ModuleId, ServiceId } from "./ids.js";

export type ServiceKind = "frontend" | "backend-service" | "worker" | "queue-consumer" | "external-api" | "cache" | "database";

/** An application-level architectural unit used by the Architecture Engine (Section 16). */
export interface ServiceEntity {
  readonly id: ServiceId;
  readonly name: string;
  readonly kind: ServiceKind;
  readonly moduleIds: readonly ModuleId[];
  readonly endpointIds: readonly EndpointId[];
  readonly dependsOnServiceIds: readonly ServiceId[];
}
