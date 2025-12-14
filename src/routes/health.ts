import type { Hono } from "hono";
import type { AppDependencies } from "../app";

export const registerHealthRoutes = (app: Hono, { serviceName }: AppDependencies) => {
  app.get("/health", (c) => c.json({ ok: true, service: serviceName }));
};
