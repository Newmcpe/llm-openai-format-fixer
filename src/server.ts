import { serve } from "bun";
import { loadEnvConfig } from "@/config/env";
import { createApp, createDefaultDependencies } from "./app";

export const startServer = () => {
  const envConfig = loadEnvConfig();
  const dependencies = createDefaultDependencies();
  const app = createApp(dependencies);
  const port = envConfig.port;

  return serve({
    fetch: app.fetch,
    port,
    hostname: "0.0.0.0",
  });
};

if (import.meta.main) {
  const server = startServer();
  console.log(`Server running on http://0.0.0.0:${server.port}`);
}
