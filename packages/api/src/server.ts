import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { DEFAULT_LIMITS, type ApiLimits } from "./config/limits.js";
import { registerScanRoutes } from "./routes/scan.routes.js";

export interface BuildServerOptions {
  readonly limits?: ApiLimits;
  readonly rateLimitMax?: number;
  readonly rateLimitTimeWindowMs?: number;
}

/** Pure factory, no side effects beyond constructing the Fastify instance — testable via `app.inject()`. */
export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const app = Fastify({ logger: false });

  await app.register(multipart, {
    limits: {
      fileSize: limits.maxUploadBytes,
      files: 200,
    },
  });

  await app.register(rateLimit, {
    max: options.rateLimitMax ?? 30,
    timeWindow: options.rateLimitTimeWindowMs ?? 60_000,
  });

  registerScanRoutes(app, limits);

  return app;
}
