import type { Hono } from "hono";
import type { AppDependencies } from "../app";

export interface HealthResponse {
  ok: boolean;
  service: string;
}

export const registerHealthRoutes = (app: Hono, { serviceName }: AppDependencies): void => {
  app.get("/health", (c) => c.json<HealthResponse>({ ok: true, service: serviceName }));
};
