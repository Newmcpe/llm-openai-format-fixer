import { Hono } from "hono";
import type { EnvConfig } from "./config/env";
import { loadEnvConfig } from "./config/env";
import { createApiController } from "./controllers/apiController";
import { createHealthController } from "./controllers/healthController";
import { createLlmService } from "./services/factory";

export interface AppDependencies {
  serviceName: string;
  version: string;
  models: string[];
}

export const createDefaultDependencies = (
  envConfig: EnvConfig = loadEnvConfig(),
): AppDependencies => ({
  serviceName: envConfig.serviceName,
  version: envConfig.serviceVersion,
  models: envConfig.models,
});

export const createApp = (dependencies: AppDependencies): Hono => {
  const app = new Hono();
  const llmService = createLlmService(dependencies);

  createHealthController(llmService)(app);
  createApiController(llmService)(app);

  return app;
};
