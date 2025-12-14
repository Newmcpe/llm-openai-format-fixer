import type { Hono } from "hono";
import type { LlmService } from "../services/llmService";
import { buildSuccessResponse } from "../utils/response";
import { readJsonBody } from "../utils/validation";

export const createApiController = (llmService: LlmService) => (app: Hono) => {
  app.get("/", (c) => c.json(buildSuccessResponse(llmService.getStatus())));
  app.on("HEAD", "/", (c) => c.text("", 200));

  app.get("/v1", (c) => c.json(buildSuccessResponse(llmService.getStatus())));
  app.on("HEAD", "/v1", (c) => c.text("", 200));

  app.get("/v1/models", (c) => c.json(buildSuccessResponse(llmService.listModels())));

  app.post("/v1/responses", async (c) => {
    const body = await readJsonBody(c.req);

    return c.json(buildSuccessResponse(llmService.createResponse(body)));
  });

  app.post("/v1/chat/completions", async (c) => {
    const body = await readJsonBody(c.req);

    return c.json(buildSuccessResponse(llmService.createChatCompletion(body)));
  });
};
