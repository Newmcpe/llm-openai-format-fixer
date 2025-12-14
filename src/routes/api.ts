import { randomUUID } from "crypto";
import type { Hono } from "hono";
import type { AppDependencies } from "../app";

const buildModelsList = (models: string[], ownedBy: string) =>
  models.map((id) => ({
    id,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: ownedBy,
  }));

const safeRandomId = (prefix: string) => `${prefix}-${randomUUID()}`;

const formatEchoContent = (payload: unknown) => {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload);
};

export const registerApiRoutes = (app: Hono, deps: AppDependencies) => {
  const { serviceName, version, models } = deps;

  app.get("/", (c) => c.json({ status: "ok", service: serviceName, version }));
  app.on("HEAD", "/", (c) => c.text("", 200));

  app.get("/v1", (c) => c.json({ status: "ok", service: serviceName, version }));
  app.on("HEAD", "/v1", (c) => c.text("", 200));

  app.get("/v1/models", (c) =>
    c.json({
      object: "list",
      data: buildModelsList(models, serviceName),
    }),
  );

  app.post("/v1/responses", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const model = (body as { model?: string }).model ?? models[0];
    const input = (body as { input?: unknown }).input ?? null;

    const id = safeRandomId("resp");
    const messageContent = formatEchoContent(input);

    return c.json({
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: messageContent },
          finish_reason: "stop",
        },
      ],
      usage: null,
    });
  });

  app.post("/v1/chat/completions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const model = (body as { model?: string }).model ?? models[0];
    const messages = (body as { messages?: unknown }).messages ?? [];

    const id = safeRandomId("chatcmpl");
    const messageContent = formatEchoContent(messages);

    return c.json({
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: messageContent },
          finish_reason: "stop",
        },
      ],
      usage: null,
    });
  });
};
