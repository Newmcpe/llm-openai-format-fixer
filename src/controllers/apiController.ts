import type {Hono} from "hono";
import {stream} from "hono/streaming";
import type {ContentfulStatusCode} from "hono/utils/http-status";
import {type AnthropicMessagesRequest, type LlmService, UpstreamProxyError} from "../services/llmService";
import {readJsonBody} from "../utils/validation";

const toContentfulStatus = (status: number): ContentfulStatusCode => {
    if (status >= 200 && status <= 599) return status as ContentfulStatusCode;
    return 500;
};

export const createApiController = (llmService: LlmService, proxyKey: string) => (app: Hono) => {
  app.get("/", (c) => c.json(llmService.getStatus()));
  app.on("HEAD", "/", (c) => c.text("", 200));

  app.get("/v1", (c) => c.json(llmService.getStatus()));
  app.on("HEAD", "/v1", (c) => c.text("", 200));

    app.get("/v1/models", async (c) => {
        try {
            return c.json(await llmService.listModels());
        } catch (error) {
            if (error instanceof UpstreamProxyError) {
                return c.json(error.payload, toContentfulStatus(error.status));
            }
            const message = error instanceof Error ? error.message : "Proxy error";
            return c.json({error: {message}}, 500);
        }
    });

  app.post("/v1/responses", async (c) => {
      try {
          if (proxyKey) {
              const key = (c.req.header("x-proxy-key") || "").trim();
              if (key !== proxyKey) {
                  return c.json({error: {message: "Unauthorized"}}, 401);
              }
          }

          const body = await readJsonBody<Record<string, unknown>>(c.req);

          const model = typeof body.model === "string" ? body.model.trim() : "";
          if (!model) {
              return c.json({error: {message: "model is required"}}, 400);
          }

          if (body.input == null) {
              return c.json({error: {message: "input is required"}}, 400);
          }

          return c.json(await llmService.createResponse(body));
      } catch (error) {
          if (error instanceof UpstreamProxyError) {
              return c.json(error.payload, toContentfulStatus(error.status));
          }

          const message = error instanceof Error ? error.message : "Proxy error";
          return c.json({error: {message}}, 500);
      }
  });

  app.post("/v1/chat/completions", async (c) => {
      try {
          if (proxyKey) {
              const key = (c.req.header("x-proxy-key") || "").trim();
              if (key !== proxyKey) {
                  return c.json({error: {message: "Unauthorized"}}, 401);
              }
          }

          const body = await readJsonBody(c.req);
          const result = await llmService.createChatCompletion(body);

          if (result instanceof ReadableStream) {
              return new Response(result, {
                  headers: {
                      "content-type": "text/event-stream",
                      "cache-control": "no-cache",
                      "connection": "keep-alive",
                  },
              });
          }

          return c.json(result);
      } catch (error) {
          if (error instanceof UpstreamProxyError) {
              return c.json(error.payload, toContentfulStatus(error.status));
          }

          const message = error instanceof Error ? error.message : "Proxy error";
          return c.json({error: {message}}, 500);
      }
  });

    app.post("/v1/messages", async (c) => {
        try {
            if (proxyKey) {
                const apiKey = c.req.header("x-api-key") || c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || "";
                if (apiKey.trim() !== proxyKey) {
                    return c.json({
                        type: "error",
                        error: {type: "authentication_error", message: "Invalid API key"}
                    }, 401);
                }
            }

            const body = await readJsonBody<Record<string, unknown>>(c.req);

            if (!body.model || typeof body.model !== "string") {
                return c.json({
                    type: "error",
                    error: {type: "invalid_request_error", message: "model is required"}
                }, 400);
            }

            if (!body.max_tokens || typeof body.max_tokens !== "number") {
                return c.json({
                    type: "error",
                    error: {type: "invalid_request_error", message: "max_tokens is required"}
                }, 400);
            }

            if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
                return c.json({
                    type: "error",
                    error: {type: "invalid_request_error", message: "messages is required"}
                }, 400);
            }

            const result = await llmService.createAnthropicMessage(body as AnthropicMessagesRequest);

            if (result instanceof ReadableStream) {
                c.header("content-type", "text/event-stream");
                c.header("cache-control", "no-cache");
                return stream(c, async (s) => {
                    await s.pipe(result);
                });
            }

            return c.json(result);
        } catch (error) {
            if (error instanceof UpstreamProxyError) {
                return c.json({
                    type: "error",
                    error: {type: "api_error", message: error.message}
                }, toContentfulStatus(error.status));
            }

            const message = error instanceof Error ? error.message : "Internal error";
            return c.json({type: "error", error: {type: "api_error", message}}, 500);
        }
  });
};
