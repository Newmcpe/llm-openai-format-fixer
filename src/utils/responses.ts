import { randomUUID } from "crypto";

export type StatusResponse = {
  status: string;
  service: string;
  version: string;
};

export type ModelDescriptor = {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
};

export type ModelListResponse = {
  object: "list";
  data: ModelDescriptor[];
};

export type ChatMessage = {
  role: "assistant" | "user" | "system";
  content: string;
};

export type ChatCompletionChoice = {
  index: number;
  message: ChatMessage;
  finish_reason: "stop";
};

export type OutputText = {
  type: "output_text";
  text: {
    value: string;
  };
};

export type ResponseOutput = {
  content: OutputText[];
};

export type ResponseResponse = {
  id: string;
  object: "response";
  created: number;
  model: string;
  output: ResponseOutput[];
  stop_reason: "stop";
  usage: null;
};

export type ChatCompletionResponse = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: null;
};

export const buildModelsList = (models: string[], ownedBy: string): ModelDescriptor[] =>
  models.map((id) => ({
    id,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: ownedBy,
  }));

export const safeRandomId = (prefix: string) => `${prefix}-${randomUUID()}`;

export const formatEchoContent = (payload: unknown) => {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload);
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

export const buildResponseOutput = (
  idPrefix: string,
  model: string,
  messageContent: string,
): ResponseResponse => ({
  id: safeRandomId(idPrefix),
  object: "response",
  created: nowSeconds(),
  model,
  output: [
    {
      content: [
        {
          type: "output_text",
          text: { value: messageContent },
        },
      ],
    },
  ],
  stop_reason: "stop",
  usage: null,
});

export const buildChatCompletionResponse = (
  idPrefix: string,
  model: string,
  messageContent: string,
): ChatCompletionResponse => ({
  id: safeRandomId(idPrefix),
  object: "chat.completion",
  created: nowSeconds(),
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
