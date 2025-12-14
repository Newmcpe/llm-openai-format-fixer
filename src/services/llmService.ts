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

export interface LlmService {
  getStatus(): StatusResponse;
  listModels(): ModelListResponse;

    createResponse(body: unknown): Promise<ResponseResponse>;

    createChatCompletion(body: unknown): Promise<ChatCompletionResponse>;
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

  listModels(): ModelListResponse {
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
}

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
): Promise<{ assistantText: string; toolCalls: ToolCall[]; model: string; usage: unknown | null }> => {
    const decoder = new TextDecoder("utf-8");
    const reader = upstreamResp.body?.getReader();

    if (!reader) {
        throw new Error("Upstream response has no body");
    }

    let buffer = "";
    let assistantText = "";
    let model = "custom-llm";
    let usage: unknown | null = null;

    const toolCalls: ToolCall[] = [];

    while (true) {
        const {done, value} = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, {stream: true});

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

    listModels(): ModelListResponse {
        return {
            object: "list",
            data: buildModelsList(this.modelRepository.listModels(), this.serviceName),
        };
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

        const upstreamResp = await fetch(upstreamChatUrl, {
            method: "POST",
            headers: {...authHeadersForUpstream(this.customLlmKey), accept: "text/event-stream"},
            body: JSON.stringify({...chatReq, stream: true}),
        });

        const contentType = upstreamResp.headers.get("content-type") || "";
        if (!upstreamResp.ok) {
            const errText = await upstreamResp.text().catch(() => "");
            throw new Error(`Upstream error ${upstreamResp.status}: ${errText}`);
        }

        if (!contentType.includes("text/event-stream")) {
            const text = await upstreamResp.text().catch(() => "");
            throw new Error(`Expected SSE from upstream, got ${contentType}: ${text}`);
        }

        const assembled = await readSSEAndAssembleChatCompletion(upstreamResp);

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
        const model = pickString(
            pickValue<string | undefined>(body, "model", undefined),
            this.modelRepository.defaultModel(),
        );

        const messages = pickValue(body, "messages", [] as unknown) as ChatCompletionsMessage[];
        if (!Array.isArray(messages) || messages.length === 0) {
            throw new Error("messages[] is required");
        }

        const upstreamChatUrl = upstreamUrlFor(this.customLlmUrl, "/v1/chat/completions");
        if (!upstreamChatUrl) {
            throw new Error("CUSTOM_LLM_URL is not set/invalid");
        }

        const upstreamResp = await fetch(upstreamChatUrl, {
            method: "POST",
            headers: {...authHeadersForUpstream(this.customLlmKey), accept: "text/event-stream"},
            body: JSON.stringify({model, messages, stream: true}),
        });

        const contentType = upstreamResp.headers.get("content-type") || "";
        if (!upstreamResp.ok) {
            const errText = await upstreamResp.text().catch(() => "");
            throw new Error(`Upstream error ${upstreamResp.status}: ${errText}`);
        }

        if (!contentType.includes("text/event-stream")) {
            const text = await upstreamResp.text().catch(() => "");
            throw new Error(`Expected SSE from upstream, got ${contentType}: ${text}`);
        }

        const assembled = await readSSEAndAssembleChatCompletion(upstreamResp);
        const content = assembled.assistantText || "";

        return buildChatCompletionResponse("chatcmpl", assembled.model || model, content);
    }
}
