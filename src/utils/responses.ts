import {randomUUID} from "crypto";

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

export type ToolCall = {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
};

export type ResponseFunctionCall = {
    type: "function_call";
    call_id: string;
    name: string;
    arguments: string;
};

export type ResponseOutputItem = ResponseMessage | ResponseFunctionCall;

export type ResponseResponse = {
  id: string;
  object: "response";
  created_at: number;
  status: "completed";
  error: null;
  incomplete_details: null;
    instructions: string | null;
    max_output_tokens: number | null;
  model: string;
    output: ResponseOutputItem[];
    parallel_tool_calls: boolean;
    previous_response_id: string | null;
  reasoning: { effort: null; summary: null };
    store: boolean;
  temperature: number;
    text: unknown;
    tool_choice: unknown;
    tools: unknown[];
  top_p: number;
  truncation: "disabled";
    usage: unknown;
  user: null;
    metadata: Record<string, unknown>;
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

type ResponsesProxyOutputRequest = {
    instructions: string | null;
    max_output_tokens: number | null;
    previous_response_id: string | null;
    store: boolean;
    temperature: number;
    text: unknown;
    tool_choice: unknown;
    tools: unknown[];
    top_p: number;
    parallel_tool_calls: boolean;
    usage: unknown;
    metadata: Record<string, unknown>;
};

type BuildResponsesProxyOutputArgs = {
    model: string;
    assistantText: string;
    toolCalls: ToolCall[];
    request: ResponsesProxyOutputRequest;
};

export const buildResponsesProxyOutput = ({
                                              model,
                                              assistantText,
                                              toolCalls,
                                              request,
                                          }: BuildResponsesProxyOutputArgs): ResponseResponse => {
    const respId = safeRandomId("resp");
    const msgId = safeRandomId("msg");
    const created_at = nowSeconds();

    const content: ResponseContent[] = [];
    if (assistantText) {
        content.push({type: "output_text", text: assistantText, annotations: []});
    }

    const output: ResponseOutputItem[] = [
        {
            type: "message",
            id: msgId,
            status: "completed",
            role: "assistant",
            content,
        },
    ];

    for (const tc of toolCalls) {
        output.push({
            type: "function_call",
            call_id: tc.id,
            name: tc.function?.name ?? "",
            arguments: tc.function?.arguments ?? "",
        });
    }

    return {
        id: respId,
        object: "response",
        created_at,
        status: "completed",
        error: null,
        incomplete_details: null,
        instructions: request.instructions,
        max_output_tokens: request.max_output_tokens,
        model,
        output,
        parallel_tool_calls: request.parallel_tool_calls,
        previous_response_id: request.previous_response_id,
        reasoning: {effort: null, summary: null},
        store: request.store,
        temperature: request.temperature,
        text: request.text,
        tool_choice: request.tool_choice,
        tools: request.tools,
        top_p: request.top_p,
        truncation: "disabled",
        usage: request.usage,
        user: null,
        metadata: request.metadata,
        output_text: assistantText,
    };
};

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
