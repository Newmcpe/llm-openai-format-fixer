import type {ModelRepository} from "../repositories/modelRepository";
import {
    buildChatCompletionResponse,
    buildModelsList,
    buildResponseOutput,
    buildResponsesProxyOutput,
    type ChatCompletionResponse,
    formatEchoContent,
    type ModelListResponse,
    type ResponseResponse,
    type StatusResponse,
    type ToolCall,
} from "../utils/responses";
import {pickString, pickValue} from "../utils/validation";
import * as fs from "fs";
import * as path from "path";

const logDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, {recursive: true});
}
const logFileName = `proxy-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
const logFilePath = path.join(logDir, logFileName);
const logStream = fs.createWriteStream(logFilePath, {flags: "a"});

const safePreview = (val: unknown, max = 1200): string | null => {
    if (val == null) return null;
    const s = typeof val === "string" ? val : JSON.stringify(val);
    return s.length > max ? s.slice(0, max) + `…(+${s.length - max} chars)` : s;
};

const log = (level: string, msg: string, meta: Record<string, unknown> = {}) => {
    const logEntry = JSON.stringify({ts: new Date().toISOString(), level, msg, ...meta});
    console.log(logEntry);
    logStream.write(logEntry + "\n");
};

type ResponseTextFormat =
    | { type: "text" }
    | { type: "json_object" }
    | { type: "json_schema"; name?: string; strict?: boolean; schema?: unknown };

type ResponsesText = { format?: ResponseTextFormat };

type ResponsesRequestBody = {
    model?: string;
    input?: unknown;
    instructions?: string;
    temperature?: number;
    top_p?: number;
    max_output_tokens?: number;
    previous_response_id?: string;
    store?: boolean;
    tools?: unknown[];
    tool_choice?: unknown;
    parallel_tool_calls?: boolean;
    text?: ResponsesText;
    metadata?: Record<string, unknown>;
    stream?: boolean;
};

type ChatCompletionsMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content?: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
};

type ChatCompletionsTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters?: unknown;
    };
};

type ChatCompletionsToolChoice =
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } };

type ChatCompletionsResponseFormat =
    | { type: "json_object" }
    | { type: "json_schema"; json_schema: { name: string; strict: boolean; schema: unknown } };

type ChatCompletionsRequestBody = {
    model: string;
    messages: ChatCompletionsMessage[];
    stream: boolean;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    tools?: ChatCompletionsTool[];
    tool_choice?: ChatCompletionsToolChoice;
    parallel_tool_calls?: boolean;
    response_format?: ChatCompletionsResponseFormat;
};

// Anthropic Messages API types
type AnthropicContentBlock =
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
    | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = {
    role: "user" | "assistant";
    content: string | AnthropicContentBlock[];
};

type AnthropicTool = {
    name: string;
    description?: string;
    input_schema: unknown;
};

type AnthropicToolChoice =
    | { type: "auto" }
    | { type: "any" }
    | { type: "tool"; name: string };

export type AnthropicMessagesRequest = {
    model: string;
    max_tokens: number;
    messages: AnthropicMessage[];
    system?: string;
    stream?: boolean;
    temperature?: number;
    top_p?: number;
    tools?: AnthropicTool[];
    tool_choice?: AnthropicToolChoice;
    stop_sequences?: string[];
};

export type AnthropicMessagesResponse = {
    id: string;
    type: "message";
    role: "assistant";
    content: AnthropicContentBlock[];
    model: string;
    stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
    stop_sequence: string | null;
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
};

export type AnthropicStreamEvent =
    | { type: "message_start"; message: Omit<AnthropicMessagesResponse, "content"> & { content: [] } }
    | { type: "content_block_start"; index: number; content_block: AnthropicContentBlock }
    | {
    type: "content_block_delta";
    index: number;
    delta: { type: "text_delta"; text: string } | { type: "input_json_delta"; partial_json: string }
}
    | { type: "content_block_stop"; index: number }
    | {
    type: "message_delta";
    delta: { stop_reason: string | null; stop_sequence: string | null };
    usage?: { output_tokens: number }
}
    | { type: "message_stop" };

export interface LlmService {
  getStatus(): StatusResponse;

    listModels(): Promise<ModelListResponse>;

    createResponse(body: unknown): Promise<ResponseResponse>;

    createChatCompletion(body: unknown): Promise<ChatCompletionResponse>;

    createAnthropicMessage(body: AnthropicMessagesRequest): Promise<AnthropicMessagesResponse | ReadableStream<Uint8Array>>;
}

export class EchoLlmService implements LlmService {
  constructor(
    private readonly serviceName: string,
    private readonly version: string,
    private readonly modelRepository: ModelRepository,
  ) {}

  getStatus(): StatusResponse {
    return { status: "ok", service: this.serviceName, version: this.version };
  }

    async listModels(): Promise<ModelListResponse> {
    return {
      object: "list",
      data: buildModelsList(this.modelRepository.listModels(), this.serviceName),
    };
  }

    async createResponse(body: unknown): Promise<ResponseResponse> {
    const model = pickString(
      pickValue<string | undefined>(body, "model", undefined),
      this.modelRepository.defaultModel(),
    );

    const input = pickValue(body, "input", null);
    const messageContent = formatEchoContent(input);

    return buildResponseOutput("resp", model, messageContent);
  }

    async createChatCompletion(body: unknown): Promise<ChatCompletionResponse> {
    const model = pickString(
      pickValue<string | undefined>(body, "model", undefined),
      this.modelRepository.defaultModel(),
    );

    const messages = pickValue(body, "messages", [] as unknown);
    const messageContent = formatEchoContent(messages);

    return buildChatCompletionResponse("chatcmpl", model, messageContent);
  }

    async createAnthropicMessage(body: AnthropicMessagesRequest): Promise<AnthropicMessagesResponse> {
        const model = pickString(body.model, this.modelRepository.defaultModel());
        const echoContent = formatEchoContent(body.messages);

        return {
            id: `msg_${crypto.randomUUID()}`,
            type: "message",
            role: "assistant",
            content: [{type: "text", text: echoContent}],
            model,
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: {
                input_tokens: Math.ceil(echoContent.length / 4),
                output_tokens: Math.ceil(echoContent.length / 4),
            },
        };
    }
}

export class UpstreamProxyError extends Error {
    readonly status: number;
    readonly payload: { error: { message: string } };

    constructor(
        message: string,
        upstreamStatus: number,
        _contentType: string,
        _body: string,
        _mode: "sse" | "json",
    ) {
        super(message);
        this.name = "UpstreamProxyError";
        this.status = upstreamStatus >= 400 && upstreamStatus < 600 ? upstreamStatus : 502;
        this.payload = {error: {message}};
    }
}

const parseUpstreamChatCompletionJson = (
    json: unknown,
    requestedModel: string,
): { assistantText: string; toolCalls: ToolCall[]; model: string; usage: unknown | null } => {
    const obj = json as Record<string, unknown> | null;
    const model = typeof obj?.model === "string" ? obj.model : requestedModel;
    const usage = obj?.usage ?? null;

    const choice = (obj?.choices as unknown[])?.[0] as Record<string, unknown> | undefined;
    const message = choice?.message as Record<string, unknown> | undefined;

    const assistantText = typeof message?.content === "string" ? message.content : "";
    const toolCalls = Array.isArray(message?.tool_calls) ? (message.tool_calls as ToolCall[]) : [];

    return {assistantText, toolCalls, model, usage};
};

const ensureUrl = (input: string): URL | null => {
    try {
        return new URL(input);
    } catch {
        return null;
    }
};

const upstreamUrlFor = (customLlmUrl: string, pathname: string): string | null => {
    if (!customLlmUrl) return null;
    const url = ensureUrl(customLlmUrl);
    if (!url) return null;

    const looksLikeHostOnly = url.pathname === "/" || url.pathname === "" || url.pathname == null;
    if (looksLikeHostOnly) {
        const full = new URL(url.toString());
        full.pathname = pathname;
        return full.toString();
    }

    if (pathname === "/v1/chat/completions") return url.toString();

    const base = new URL(url.origin);
    base.pathname = pathname;
    return base.toString();
};

const authHeadersForUpstream = (customLlmKey: string): Record<string, string> => ({
    "content-type": "application/json",
    ...(customLlmKey ? {authorization: `Bearer ${customLlmKey}`} : {}),
});

const normalizeTools = (tools: unknown): ChatCompletionsTool[] | undefined => {
    if (!Array.isArray(tools)) return undefined;

    const out: ChatCompletionsTool[] = [];
    for (const tool of tools) {
        if (!tool || typeof tool !== "object") continue;

        const t = tool as Record<string, unknown>;
        if (t.type !== "function") continue;

        const fn = t.function;
        if (fn && typeof fn === "object") {
            out.push(tool as ChatCompletionsTool);
            continue;
        }

        if (typeof t.name === "string") {
            out.push({
                type: "function",
                function: {
                    name: t.name,
                    description: typeof t.description === "string" ? t.description : undefined,
                    parameters: t.parameters,
                },
            });
        }
    }

    return out;
};

const normalizeToolChoice = (toolChoice: unknown): ChatCompletionsToolChoice | undefined => {
    if (!toolChoice) return undefined;
    if (typeof toolChoice === "string") return toolChoice as ChatCompletionsToolChoice;
    if (typeof toolChoice !== "object") return undefined;

    const t = toolChoice as Record<string, unknown>;
    if (t.type !== "function") return toolChoice as ChatCompletionsToolChoice;

    const fn = t.function;
    if (fn && typeof fn === "object" && typeof (fn as Record<string, unknown>).name === "string") {
        return toolChoice as ChatCompletionsToolChoice;
    }

    if (typeof t.name === "string") {
        return {type: "function", function: {name: t.name}};
    }

    return toolChoice as ChatCompletionsToolChoice;
};

const inputToMessages = (input: unknown): ChatCompletionsMessage[] => {
    if (typeof input === "string") {
        return [{role: "user", content: input}];
    }

    if (!Array.isArray(input)) {
        return [{role: "user", content: String(input ?? "")}];
    }

    const messages: ChatCompletionsMessage[] = [];
    for (const item of input) {
        const m = item as any;

        if (m?.type === "function_call") {
            messages.push({
                role: "assistant",
                content: "",
                tool_calls: [
                    {
                        id: String(m.call_id ?? ""),
                        type: "function",
                        function: {
                            name: String(m.name ?? ""),
                            arguments: typeof m.arguments === "string" ? m.arguments : "",
                        },
                    },
                ],
            });
            continue;
        }

        if (m?.type === "function_call_output") {
            messages.push({
                role: "tool",
                tool_call_id: String(m.call_id ?? ""),
                content: typeof m.output === "string" ? m.output : JSON.stringify(m.output ?? null),
            });
            continue;
        }

        if (m?.type === "message" || m?.role) {
            const role = (m.role ?? "user") as ChatCompletionsMessage["role"];

            if (typeof m?.content === "string") {
                messages.push({role, content: m.content});
                continue;
            }

            if (Array.isArray(m?.content)) {
                const texts = m.content
                    .map((p: any) =>
                        p?.type === "input_text" || p?.type === "text" || p?.type === "output_text" ? p.text : null,
                    )
                    .filter(Boolean);
                messages.push({role, content: texts.join("")});
                continue;
            }

            messages.push({role, content: String(m?.content ?? "")});
            continue;
        }

        messages.push({role: "user", content: String(m?.content ?? m ?? "")});
    }

    return messages;
};

const extractProbablyJSON = (text: string): unknown | null => {
    const s = text.trim();
    if (!s) return null;

    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
        try {
            return JSON.parse(s);
        } catch {
            // ignore
        }
    }

    const firstObj = s.indexOf("{");
    const firstArr = s.indexOf("[");

    let start = -1;
    let open = "";
    let close = "";

    if (firstObj !== -1 && (firstArr === -1 || firstObj < firstArr)) {
        start = firstObj;
        open = "{";
        close = "}";
    } else if (firstArr !== -1) {
        start = firstArr;
        open = "[";
        close = "]";
    }

    if (start === -1) return null;

    let depth = 0;
    for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (ch === open) depth++;
        if (ch === close) depth--;

        if (depth === 0) {
            const candidate = s.slice(start, i + 1);
            try {
                return JSON.parse(candidate);
            } catch {
                return null;
            }
        }
    }

    return null;
};

const readSSEAndAssembleChatCompletion = async (
    upstreamResp: Response,
    requestedModel: string,
): Promise<{ assistantText: string; toolCalls: ToolCall[]; model: string; usage: unknown | null }> => {
    const decoder = new TextDecoder("utf-8");
    const reader = upstreamResp.body?.getReader();

    if (!reader) {
        throw new Error("Upstream response has no body");
    }

    let buffer = "";
    let assistantText = "";
    let model = requestedModel;
    let usage: unknown | null = null;
    let chunkCount = 0;

    const toolCalls: ToolCall[] = [];

    while (true) {
        const {done, value} = await reader.read();
        if (done) {
            log("info", "sse_stream_done", {
                chunkCount,
                assistantTextLength: assistantText.length,
                toolCallsCount: toolCalls.length
            });
            break;
        }

        const chunk = decoder.decode(value, {stream: true});
        chunkCount++;
        if (chunkCount <= 3) {
            log("info", "sse_chunk", {chunkNum: chunkCount, chunk: safePreview(chunk, 500)});
        }
        buffer += chunk;

        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, idx).trimEnd();
            buffer = buffer.slice(idx + 1);

            if (!line.startsWith("data:")) continue;

            const data = line.slice(5).trim();
            if (!data) continue;
            if (data === "[DONE]") {
                return {assistantText, toolCalls: toolCalls.filter(Boolean), model, usage};
            }

            let obj: any;
            try {
                obj = JSON.parse(data);
            } catch {
                continue;
            }

            if (obj?.model) model = obj.model;
            if (obj?.usage) usage = obj.usage;

            const fullContent = obj?.choices?.[0]?.message?.content;
            if (typeof fullContent === "string") {
                assistantText = fullContent;
                const fullToolCalls = obj?.choices?.[0]?.message?.tool_calls;
                if (Array.isArray(fullToolCalls)) {
                    return {assistantText, toolCalls: fullToolCalls as ToolCall[], model, usage};
                }
                continue;
            }

            const delta = obj?.choices?.[0]?.delta;
            if (typeof delta?.content === "string") {
                assistantText += delta.content;
            }
            if (typeof delta?.reasoning_content === "string") {
                assistantText += delta.reasoning_content;
            }
            if (typeof delta?.text === "string") {
                assistantText += delta.text;
            }

            const deltaToolCalls = delta?.tool_calls;
            if (Array.isArray(deltaToolCalls)) {
                for (const tc of deltaToolCalls) {
                    const index = typeof tc?.index === "number" ? tc.index : 0;

                    if (!toolCalls[index]) {
                        toolCalls[index] = {
                            id: typeof tc?.id === "string" ? tc.id : "",
                            type: typeof tc?.type === "string" ? tc.type : "function",
                            function: {
                                name: typeof tc?.function?.name === "string" ? tc.function.name : "",
                                arguments: "",
                            },
                        };
                    }

                    const chunkArgs = tc?.function?.arguments;
                    if (typeof chunkArgs === "string") {
                        toolCalls[index].function.arguments += chunkArgs;
                    }
                }
            }
        }
    }

    return {assistantText, toolCalls: toolCalls.filter(Boolean), model, usage};
};

// Anthropic <-> OpenAI conversion functions
const anthropicToOpenAIMessages = (
    messages: AnthropicMessagesRequest["messages"],
    system?: string,
): ChatCompletionsMessage[] => {
    const result: ChatCompletionsMessage[] = [];

    if (system) {
        result.push({role: "system", content: system});
    }

    for (const msg of messages) {
        if (typeof msg.content === "string") {
            result.push({role: msg.role, content: msg.content});
            continue;
        }

        for (const block of msg.content) {
            if (block.type === "text") {
                result.push({role: msg.role, content: block.text});
            } else if (block.type === "tool_use") {
                result.push({
                    role: "assistant",
                    content: "",
                    tool_calls: [{
                        id: block.id,
                        type: "function",
                        function: {
                            name: block.name,
                            arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input),
                        },
                    }],
                });
            } else if (block.type === "tool_result") {
                result.push({
                    role: "tool",
                    tool_call_id: block.tool_use_id,
                    content: block.content,
                });
            }
        }
    }

    return result;
};

const anthropicToOpenAITools = (
    tools?: AnthropicMessagesRequest["tools"],
): ChatCompletionsTool[] | undefined => {
    if (!tools || tools.length === 0) return undefined;

    return tools.map((tool) => ({
        type: "function" as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
        },
    }));
};

const anthropicToOpenAIToolChoice = (
    toolChoice?: AnthropicMessagesRequest["tool_choice"],
): ChatCompletionsToolChoice | undefined => {
    if (!toolChoice) return undefined;

    if (toolChoice.type === "auto") return "auto";
    if (toolChoice.type === "any") return "required";
    if (toolChoice.type === "tool") {
        return {type: "function", function: {name: toolChoice.name}};
    }

    return undefined;
};

const openAIToAnthropicResponse = (
    json: unknown,
    model: string,
): AnthropicMessagesResponse => {
    const obj = json as Record<string, unknown>;
    const choice = (obj?.choices as unknown[])?.[0] as Record<string, unknown> | undefined;
    const message = choice?.message as Record<string, unknown> | undefined;

    const content: Array<{ type: "text"; text: string } | {
        type: "tool_use";
        id: string;
        name: string;
        input: unknown
    }> = [];

    if (typeof message?.content === "string" && message.content) {
        content.push({type: "text", text: message.content});
    }

    const toolCalls = message?.tool_calls as ToolCall[] | undefined;
    if (Array.isArray(toolCalls)) {
        for (const tc of toolCalls) {
            let input: unknown = {};
            try {
                input = JSON.parse(tc.function.arguments);
            } catch {
                input = tc.function.arguments;
            }
            content.push({
                type: "tool_use",
                id: tc.id,
                name: tc.function.name,
                input,
            });
        }
    }

    const finishReason = choice?.finish_reason as string | undefined;
    let stopReason: AnthropicMessagesResponse["stop_reason"] = "end_turn";
    if (finishReason === "length") stopReason = "max_tokens";
    else if (finishReason === "stop") stopReason = "end_turn";
    else if (finishReason === "tool_calls") stopReason = "tool_use";

    const usage = obj?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;

    return {
        id: `msg_${crypto.randomUUID()}`,
        type: "message",
        role: "assistant",
        content,
        model: (obj?.model as string) || model,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
            input_tokens: usage?.prompt_tokens ?? 0,
            output_tokens: usage?.completion_tokens ?? 0,
        },
    };
};

const createAnthropicStreamFromOpenAI = (
    upstreamResp: Response,
    model: string,
): ReadableStream<Uint8Array> => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder("utf-8");
    const reader = upstreamResp.body?.getReader();

    if (!reader) {
        throw new Error("Upstream response has no body");
    }

    let buffer = "";
    let sentMessageStart = false;
    let contentBlockStarted = false;
    let contentBlockStopped = false;
    let currentToolCallIndex = -1;
    let pullCount = 0;
    let totalTextLength = 0;
    const toolCallsInProgress: Map<number, { id: string; name: string; arguments: string }> = new Map();
    const closedToolCallIndices: Set<number> = new Set();

    const msgId = `msg_${crypto.randomUUID()}`;

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const {done, value} = await reader.read();
            pullCount++;

            if (done) {
                log("info", "anthropic_stream_done", {
                    pullCount,
                    totalTextLength,
                    toolCallsCount: toolCallsInProgress.size
                });
                // Close text content block if started but not yet stopped
                if (contentBlockStarted && !contentBlockStopped) {
                    controller.enqueue(encoder.encode(`event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`));
                    contentBlockStopped = true;
                }
                // Close any unclosed tool call blocks
                for (const [tcIdx] of toolCallsInProgress) {
                    if (!closedToolCallIndices.has(tcIdx)) {
                        controller.enqueue(encoder.encode(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${tcIdx + 1}}\n\n`));
                        closedToolCallIndices.add(tcIdx);
                    }
                }
                controller.enqueue(encoder.encode(`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null}}\n\n`));
                controller.enqueue(encoder.encode(`event: message_stop\ndata: {"type":"message_stop"}\n\n`));
                controller.close();
                return;
            }

            const chunk = decoder.decode(value, {stream: true});
            if (pullCount <= 3) {
                log("info", "anthropic_stream_chunk", {pullNum: pullCount, chunk: safePreview(chunk, 500)});
            }
            buffer += chunk;

            let idx: number;
            while ((idx = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, idx).trimEnd();
                buffer = buffer.slice(idx + 1);

                if (!line.startsWith("data:")) continue;

                const data = line.slice(5).trim();
                if (!data || data === "[DONE]") continue;

                let obj: any;
                try {
                    obj = JSON.parse(data);
                } catch {
                    continue;
                }

                if (!sentMessageStart) {
                    const startEvent: AnthropicStreamEvent = {
                        type: "message_start",
                        message: {
                            id: msgId,
                            type: "message",
                            role: "assistant",
                            content: [],
                            model: obj?.model || model,
                            stop_reason: null,
                            stop_sequence: null,
                            usage: {input_tokens: 0, output_tokens: 0},
                        },
                    };
                    controller.enqueue(encoder.encode(`event: message_start\ndata: ${JSON.stringify(startEvent)}\n\n`));
                    sentMessageStart = true;
                }

                const delta = obj?.choices?.[0]?.delta;
                const finishReason = obj?.choices?.[0]?.finish_reason;

                // Handle text content (including reasoning_content from thinking models)
                if (delta) {
                    const textContent = delta.content ?? delta.reasoning_content;
                    if (typeof textContent === "string") {
                        // Start content block if not started
                        if (!contentBlockStarted) {
                            controller.enqueue(encoder.encode(`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`));
                            contentBlockStarted = true;
                        }
                        // Send delta even for empty strings to maintain event order
                        if (textContent) {
                            totalTextLength += textContent.length;
                            const deltaEvent = {
                                type: "content_block_delta",
                                index: 0,
                                delta: {type: "text_delta", text: textContent},
                            };
                            controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(deltaEvent)}\n\n`));
                        }
                    }

                    // Handle tool calls
                    if (Array.isArray(delta.tool_calls)) {
                        for (const tc of delta.tool_calls) {
                            const tcIndex = tc.index ?? 0;

                            if (!toolCallsInProgress.has(tcIndex)) {
                                // Close text content block before starting tool calls
                                if (contentBlockStarted && !contentBlockStopped && currentToolCallIndex === -1) {
                                    controller.enqueue(encoder.encode(`event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`));
                                    contentBlockStopped = true;
                                }
                                currentToolCallIndex = tcIndex;
                                toolCallsInProgress.set(tcIndex, {
                                    id: tc.id || "",
                                    name: tc.function?.name || "",
                                    arguments: "",
                                });

                                const blockStart = {
                                    type: "content_block_start",
                                    index: tcIndex + 1,
                                    content_block: {
                                        type: "tool_use",
                                        id: tc.id || "",
                                        name: tc.function?.name || "",
                                        input: {},
                                    },
                                };
                                controller.enqueue(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`));
                            }

                            const existing = toolCallsInProgress.get(tcIndex)!;
                            if (tc.function?.arguments) {
                                existing.arguments += tc.function.arguments;
                                const deltaEvent = {
                                    type: "content_block_delta",
                                    index: tcIndex + 1,
                                    delta: {type: "input_json_delta", partial_json: tc.function.arguments},
                                };
                                controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(deltaEvent)}\n\n`));
                            }
                        }
                    }
                }

                // Handle finish reason - must come AFTER processing deltas
                if (finishReason) {
                    // Close text content block if it was started but not stopped
                    if (contentBlockStarted && !contentBlockStopped) {
                        controller.enqueue(encoder.encode(`event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`));
                        contentBlockStopped = true;
                    }

                    // Close tool call blocks
                    for (const [tcIdx] of toolCallsInProgress) {
                        if (!closedToolCallIndices.has(tcIdx)) {
                            controller.enqueue(encoder.encode(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${tcIdx + 1}}\n\n`));
                            closedToolCallIndices.add(tcIdx);
                        }
                    }

                    let stopReason = "end_turn";
                    if (finishReason === "length") stopReason = "max_tokens";
                    else if (finishReason === "tool_calls") stopReason = "tool_use";

                    controller.enqueue(encoder.encode(`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"${stopReason}","stop_sequence":null}}\n\n`));
                    controller.enqueue(encoder.encode(`event: message_stop\ndata: {"type":"message_stop"}\n\n`));
                    controller.close();
                    return;
                }
            }
        },
    });
};

export class ProxyLlmService implements LlmService {
    constructor(
        private readonly serviceName: string,
        private readonly version: string,
        private readonly modelRepository: ModelRepository,
        private readonly customLlmUrl: string,
        private readonly customLlmKey: string,
    ) {
    }

    getStatus(): StatusResponse {
        return {status: "ok", service: this.serviceName, version: this.version};
    }

    async listModels(): Promise<ModelListResponse> {
        const upstreamModelsUrl = upstreamUrlFor(this.customLlmUrl, "/v1/models");
        if (!upstreamModelsUrl) {
            return {
                object: "list",
                data: buildModelsList(this.modelRepository.listModels(), this.serviceName),
            };
        }

        log("info", "upstream_request", {method: "GET", url: upstreamModelsUrl});

        const upstreamResp = await fetch(upstreamModelsUrl, {
            method: "GET",
            headers: authHeadersForUpstream(this.customLlmKey),
        });

        if (!upstreamResp.ok) {
            const errText = await upstreamResp.text().catch(() => "");
            log("error", "upstream_error", {status: upstreamResp.status, body: safePreview(errText, 2000)});
            throw new UpstreamProxyError(
                "Upstream models request failed",
                upstreamResp.status,
                upstreamResp.headers.get("content-type") || "",
                errText,
                "json",
            );
        }

        const json = await upstreamResp.json();
        log("info", "upstream_response", {body: safePreview(json)});
        return json as ModelListResponse;
    }

    async createResponse(body: unknown): Promise<ResponseResponse> {
        const request = (body ?? {}) as ResponsesRequestBody;

        const model = pickString(request.model, this.modelRepository.defaultModel());
        const messages = inputToMessages(request.input);

        if (!messages.length) {
            throw new Error("input is required");
        }

        let response_format: ChatCompletionsRequestBody["response_format"] | undefined;
        const fmt = request.text?.format?.type;

        if (fmt === "json_object") {
            response_format = {type: "json_object"};
        } else if (fmt === "json_schema") {
            const tf = request.text?.format as Extract<ResponseTextFormat, { type: "json_schema" }>;
            response_format = {
                type: "json_schema",
                json_schema: {
                    name: tf?.name || "schema",
                    strict: tf?.strict ?? true,
                    schema: tf?.schema,
                },
            };
        }

        const chatReq: ChatCompletionsRequestBody = {
            model,
            messages,
            stream: false,
            temperature: request.temperature,
            top_p: request.top_p,
            max_tokens: request.max_output_tokens,
            tools: normalizeTools(request.tools),
            tool_choice: normalizeToolChoice(request.tool_choice),
            parallel_tool_calls: request.parallel_tool_calls,
            response_format,
        };

        if (request.instructions) {
            chatReq.messages = [{role: "system", content: request.instructions}, ...chatReq.messages];
        }

        const upstreamChatUrl = upstreamUrlFor(this.customLlmUrl, "/v1/chat/completions");
        if (!upstreamChatUrl) {
            throw new Error("CUSTOM_LLM_URL is not set/invalid");
        }

        const upstreamStream = true; // Always stream from upstream

        const requestBody = {...chatReq, stream: upstreamStream};
        log("info", "upstream_request", {method: "POST", url: upstreamChatUrl, body: safePreview(requestBody)});

        const upstreamResp = await fetch(upstreamChatUrl, {
            method: "POST",
            headers: {
                ...authHeadersForUpstream(this.customLlmKey),
                accept: upstreamStream ? "text/event-stream" : "application/json",
            },
            body: JSON.stringify(requestBody),
        });

        const contentType = upstreamResp.headers.get("content-type") || "";
        if (!upstreamResp.ok) {
            const errText = await upstreamResp.text().catch(() => "");
            log("error", "upstream_error", {status: upstreamResp.status, body: safePreview(errText, 2000)});
            throw new UpstreamProxyError(
                "Upstream request failed",
                upstreamResp.status,
                contentType,
                errText,
                upstreamStream ? "sse" : "json",
            );
        }

        const isSse = contentType.includes("text/event-stream");

        let assembled;
        if (isSse) {
            assembled = await readSSEAndAssembleChatCompletion(upstreamResp, model);
        } else {
            const json = await upstreamResp.json();
            log("info", "upstream_response", {body: safePreview(json)});
            assembled = parseUpstreamChatCompletionJson(json, model);
        }
        log("info", "upstream_assembled", {body: safePreview(assembled)});

        let assistantText = assembled.assistantText || "";
        const toolCalls = assembled.toolCalls || [];

        if (fmt === "json_object") {
            const parsed = extractProbablyJSON(assistantText);
            if (parsed != null) assistantText = JSON.stringify(parsed);
        }

        return buildResponsesProxyOutput({
            model: assembled.model || model,
            assistantText,
            toolCalls,
            request: {
                instructions: request.instructions ?? null,
                max_output_tokens: request.max_output_tokens ?? null,
                previous_response_id: request.previous_response_id ?? null,
                store: request.store ?? true,
                temperature: request.temperature ?? 1,
                text: request.text ?? {format: {type: "text"}},
                tool_choice: request.tool_choice ?? "auto",
                tools: request.tools ?? [],
                top_p: request.top_p ?? 1,
                parallel_tool_calls: request.parallel_tool_calls ?? true,
                usage: assembled.usage ?? null,
                metadata: request.metadata ?? {},
            },
        });
    }

    async createChatCompletion(body: unknown): Promise<ChatCompletionResponse> {
        const bodyObj = (body ?? {}) as Record<string, unknown>;
        const model = pickString(
            pickValue<string | undefined>(body, "model", undefined),
            this.modelRepository.defaultModel(),
        );

        const messages = pickValue(body, "messages", [] as unknown) as ChatCompletionsMessage[];
        if (!Array.isArray(messages) || messages.length === 0) {
            throw new Error("messages[] is required");
        }

        // Normalize messages: convert content arrays to strings for compatibility
        const normalizedMessages = messages.map((msg) => {
            if (Array.isArray(msg.content)) {
                const textParts = msg.content
                    .filter((part: any) => part?.type === "text")
                    .map((part: any) => part?.text ?? "");
                return {...msg, content: textParts.join("")};
            }
            return msg;
        });

        const upstreamChatUrl = upstreamUrlFor(this.customLlmUrl, "/v1/chat/completions");
        if (!upstreamChatUrl) {
            throw new Error("CUSTOM_LLM_URL is not set/invalid");
        }

        // Pass through all fields from the original request
        const requestBody = {
            ...bodyObj,
            model,
            messages: normalizedMessages,
            stream: bodyObj.stream ?? true,
        };
        log("info", "upstream_request", {method: "POST", url: upstreamChatUrl, body: safePreview(requestBody)});

        const isStreaming = requestBody.stream === true;
        const upstreamResp = await fetch(upstreamChatUrl, {
            method: "POST",
            headers: {
                ...authHeadersForUpstream(this.customLlmKey),
                accept: isStreaming ? "text/event-stream" : "application/json",
            },
            body: JSON.stringify(requestBody),
        });

        const contentType = upstreamResp.headers.get("content-type") || "";
        if (!upstreamResp.ok) {
            const errText = await upstreamResp.text().catch(() => "");
            log("error", "upstream_error", {status: upstreamResp.status, body: safePreview(errText, 2000)});
            throw new Error(`Upstream error ${upstreamResp.status}: ${errText}`);
        }

        const isSse = contentType.includes("text/event-stream");

        let assembled;
        if (isSse) {
            log("info", "upstream_streaming_started");
            assembled = await readSSEAndAssembleChatCompletion(upstreamResp, model);
        } else {
            const json = await upstreamResp.json();
            log("info", "upstream_response", {body: safePreview(json)});
            assembled = parseUpstreamChatCompletionJson(json, model);
        }
        log("info", "upstream_assembled", {body: safePreview(assembled)});
        const content = assembled.assistantText || "";

        return buildChatCompletionResponse("chatcmpl", assembled.model || model, content);
    }

    async createAnthropicMessage(
        body: AnthropicMessagesRequest,
    ): Promise<AnthropicMessagesResponse | ReadableStream<Uint8Array>> {
        const model = pickString(body.model, this.modelRepository.defaultModel());
        const messages = anthropicToOpenAIMessages(body.messages, body.system);
        const tools = anthropicToOpenAITools(body.tools);
        const toolChoice = anthropicToOpenAIToolChoice(body.tool_choice);

        const upstreamChatUrl = upstreamUrlFor(this.customLlmUrl, "/v1/chat/completions");
        if (!upstreamChatUrl) {
            throw new Error("CUSTOM_LLM_URL is not set/invalid");
        }

        const upstreamStream = body.stream === true;

        const requestBody = {
            model,
            messages,
            stream: upstreamStream,
            max_tokens: body.max_tokens,
            temperature: body.temperature,
            top_p: body.top_p,
            tools,
            tool_choice: toolChoice,
            stop: body.stop_sequences,
        };
        log("info", "upstream_request", {method: "POST", url: upstreamChatUrl, body: safePreview(requestBody)});

        const upstreamResp = await fetch(upstreamChatUrl, {
            method: "POST",
            headers: {
                ...authHeadersForUpstream(this.customLlmKey),
                accept: upstreamStream ? "text/event-stream" : "application/json",
            },
            body: JSON.stringify(requestBody),
        });

        if (!upstreamResp.ok) {
            const errText = await upstreamResp.text().catch(() => "");
            log("error", "upstream_error", {status: upstreamResp.status, body: safePreview(errText, 2000)});
            throw new UpstreamProxyError(
                "Upstream request failed",
                upstreamResp.status,
                upstreamResp.headers.get("content-type") || "",
                errText,
                upstreamStream ? "sse" : "json",
            );
        }

        if (upstreamStream) {
            log("info", "upstream_streaming_started", {});
            return createAnthropicStreamFromOpenAI(upstreamResp, model);
        }

        const json = await upstreamResp.json();
        log("info", "upstream_response", {body: safePreview(json)});
        return openAIToAnthropicResponse(json, model);
    }
}
