import type { Hono } from "hono";
import type { LlmService } from "../services/llmService";
import { buildSuccessResponse } from "../utils/response";

export const createHealthController = (llmService: LlmService) => (app: Hono) => {
  app.get("/health", (c) => c.json(buildSuccessResponse(llmService.getStatus())));
};
