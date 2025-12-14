import { Hono } from "hono";
import { registerApiRoutes } from "./routes/api";
import { registerHealthRoutes } from "./routes/health";

export type AppDependencies = {
  serviceName: string;
  version: string;
  models: string[];
};

export const createDefaultDependencies = (): AppDependencies => {
  const modelsEnv = process.env.MODELS?.split(",").map((m) => m.trim()).filter(Boolean);

  return {
    serviceName: process.env.SERVICE_NAME?.trim() || "llm-openai-proxy",
    version: process.env.SERVICE_VERSION?.trim() || "v1",
    models: modelsEnv && modelsEnv.length > 0 ? modelsEnv : ["custom-llm"],
  };
};

export const createApp = (dependencies: AppDependencies) => {
  const app = new Hono();

  registerHealthRoutes(app, dependencies);
  registerApiRoutes(app, dependencies);

  return app;
};
