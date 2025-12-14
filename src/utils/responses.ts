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

export type ResponseContent = {
  type: "output_text";
  text: string;
  annotations: [];
};

export type ResponseMessage = {
  type: "message";
  id: string;
  status: "completed";
  role: "assistant";
  content: ResponseContent[];
};

export type ResponseResponse = {
  id: string;
  object: "response";
  created_at: number;
  status: "completed";
  error: null;
  incomplete_details: null;
  instructions: null;
  max_output_tokens: null;
  model: string;
  output: ResponseMessage[];
  parallel_tool_calls: true;
  previous_response_id: null;
  reasoning: { effort: null; summary: null };
  store: true;
  temperature: number;
  text: { format: { type: "text" } };
  tool_choice: "auto";
  tools: [];
  top_p: number;
  truncation: "disabled";
  usage: {
    input_tokens: number;
    input_tokens_details: { cached_tokens: number };
    output_tokens: number;
    output_tokens_details: { reasoning_tokens: number };
    total_tokens: number;
  };
  user: null;
  metadata: Record<string, never>;
  output_text: string;
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

const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

export const buildResponseOutput = (
  idPrefix: string,
  model: string,
  messageContent: string,
): ResponseResponse => {
  const id = safeRandomId(idPrefix);
  const created_at = nowSeconds();
  const output_tokens = estimateTokens(messageContent);

  const message: ResponseMessage = {
    type: "message",
    id: safeRandomId(`${idPrefix}-msg`),
    status: "completed",
    role: "assistant",
    content: [
      {
        type: "output_text",
        text: messageContent,
        annotations: [],
      },
    ],
  };

  return {
    id,
    object: "response",
    created_at,
    status: "completed",
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model,
    output: [message],
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: true,
    temperature: 1,
    text: { format: { type: "text" } },
    tool_choice: "auto",
    tools: [],
    top_p: 1,
    truncation: "disabled",
    usage: {
      input_tokens: 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: output_tokens,
    },
    user: null,
    metadata: {},
    output_text: messageContent,
  };
};

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
