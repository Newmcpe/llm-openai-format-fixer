import type {Hono} from "hono";
import type {LlmService} from "../services/llmService";
import {readJsonBody} from "../utils/validation";

export const createApiController = (llmService: LlmService, proxyKey: string) => (app: Hono) => {
  app.get("/", (c) => c.json(llmService.getStatus()));
  app.on("HEAD", "/", (c) => c.text("", 200));

  app.get("/v1", (c) => c.json(llmService.getStatus()));
  app.on("HEAD", "/v1", (c) => c.text("", 200));

  app.get("/v1/models", (c) => c.json(llmService.listModels()));

  app.post("/v1/responses", async (c) => {
      try {
          if (proxyKey) {
              const key = (c.req.header("x-proxy-key") || "").trim();
              if (key !== proxyKey) {
                  return c.json({error: {message: "Unauthorized"}}, 401);
              }
          }

          const body = await readJsonBody(c.req);
          return c.json(await llmService.createResponse(body));
      } catch (error) {
          const message = error instanceof Error ? error.message : "Proxy error";
          return c.json({error: {message}}, 500);
      }
  });

  app.post("/v1/chat/completions", async (c) => {
    const body = await readJsonBody(c.req);

      return c.json(await llmService.createChatCompletion(body));
  });
};
