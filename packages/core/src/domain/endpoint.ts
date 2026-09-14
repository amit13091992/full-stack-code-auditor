import type { AuthenticationModel, AuthorizationModel } from "./auth.js";
import type { EndpointId, SourceLocation, SymbolId } from "./ids.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD" | "ANY";

export type EndpointProtocol = "http" | "graphql" | "websocket" | "rpc";

export type InputLocation = "path" | "query" | "header" | "cookie" | "body" | "file";

export interface InputModel {
  readonly name: string;
  readonly location: InputLocation;
  readonly typeText?: string;
  readonly required: boolean;
}

export interface OutputModel {
  readonly statusCode?: number;
  readonly typeText?: string;
  readonly containsSensitiveData?: boolean;
}

export interface RateLimitModel {
  readonly windowMs: number;
  readonly maxRequests: number;
}

/** A discovered, framework-normalized API endpoint (Section 10). */
export interface EndpointModel {
  readonly id: EndpointId;
  readonly protocol: EndpointProtocol;
  readonly method: HttpMethod;
  readonly path: string;
  readonly framework: string;
  readonly handlers: readonly SymbolId[];
  readonly authentication?: AuthenticationModel;
  readonly authorization?: AuthorizationModel;
  readonly inputs: readonly InputModel[];
  readonly outputs: readonly OutputModel[];
  readonly rateLimit?: RateLimitModel;
  readonly location: SourceLocation;
}
