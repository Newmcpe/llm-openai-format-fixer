import { Hono } from "hono";
import { loadEnvConfig } from "@/config/env";
import { registerApiRoutes } from "./routes/api";
import { registerHealthRoutes } from "./routes/health";

export interface AppDependencies {
  serviceName: string;
  version: string;
  models: string[];
}

export const createDefaultDependencies = (): AppDependencies => {
  const envConfig = loadEnvConfig();

  return {
    serviceName: envConfig.serviceName,
    version: envConfig.serviceVersion,
    models: envConfig.models,
  };
};

export const createApp = (dependencies: AppDependencies): Hono => {
  const app = new Hono();

  registerHealthRoutes(app, dependencies);
  registerApiRoutes(app, dependencies);

  return app;
};
