import {serve} from "bun";
import {loadEnvConfig} from "./config/env";
import {createApp, createDefaultDependencies} from "./app";

export const startServer = () => {
  const envConfig = loadEnvConfig();
  const dependencies = createDefaultDependencies(envConfig);
  const app = createApp(dependencies);
  const port = envConfig.port;

  return serve({
    fetch: app.fetch,
    port,
    hostname: "0.0.0.0",
      idleTimeout: 255, // Max value for thinking models that take long to respond
  });
};

if (import.meta.main) {
  const server = startServer();
  console.log(`Server running on http://0.0.0.0:${server.port}`);
}
