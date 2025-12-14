import { randomUUID } from "crypto";
import type { Hono } from "hono";
import type { AppDependencies } from "../app";

export interface ServiceStatusResponse {
  status: "ok";
  service: string;
  version: string;
}

export interface ModelDetails {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface ModelsListResponse {
  object: "list";
  data: ModelDetails[];
}

export interface ResponsesRequestBody {
  model?: string;
  input?: unknown;
}

export interface ChatCompletionsRequestBody {
  model?: string;
  messages?: unknown;
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: "assistant";
    content: string;
  };
  finish_reason: "stop";
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: null;
}

const buildModelsList = (models: string[], ownedBy: string): ModelDetails[] =>
  models.map((id) => ({
    id,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: ownedBy,
  }));

const safeRandomId = (prefix: string): string => `${prefix}-${randomUUID()}`;

const formatEchoContent = (payload: unknown): string => {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload);
};

export const registerApiRoutes = (app: Hono, deps: AppDependencies): void => {
  const { serviceName, version, models } = deps;

  app.get("/", (c) => c.json<ServiceStatusResponse>({ status: "ok", service: serviceName, version }));
  app.on("HEAD", "/", (c) => c.text("", 200));

  app.get("/v1", (c) => c.json<ServiceStatusResponse>({ status: "ok", service: serviceName, version }));
  app.on("HEAD", "/v1", (c) => c.text("", 200));

  app.get("/v1/models", (c) =>
    c.json<ModelsListResponse>({
      object: "list",
      data: buildModelsList(models, serviceName),
    }),
  );

  app.post("/v1/responses", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as ResponsesRequestBody;
    const model = body.model ?? models[0];
    const input = body.input ?? null;

    const id = safeRandomId("resp");
    const messageContent = formatEchoContent(input);

    const responseBody: ChatCompletionResponse = {
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
    };

    return c.json(responseBody);
  });

  app.post("/v1/chat/completions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as ChatCompletionsRequestBody;
    const model = body.model ?? models[0];
    const messages = body.messages ?? [];

    const id = safeRandomId("chatcmpl");
    const messageContent = formatEchoContent(messages);

    const responseBody: ChatCompletionResponse = {
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
    };

    return c.json(responseBody);
  });
};
