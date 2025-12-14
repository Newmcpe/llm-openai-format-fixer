import type { Hono } from "hono";
import type { LlmService } from "../services/llmService";

export const createHealthController = (llmService: LlmService) => (app: Hono) => {
  app.get("/health", (c) => c.json(llmService.getStatus()));
};
