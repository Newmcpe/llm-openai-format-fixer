import { serve } from "bun";
import { createApp, createDefaultDependencies } from "./app";

export const startServer = () => {
  const dependencies = createDefaultDependencies();
  const app = createApp(dependencies);
  const port = Number(process.env.PORT || 3000);

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
