import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const app = express();

// Setup file logging
const logDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFileName = `proxy-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
const logFilePath = path.join(logDir, logFileName);
const logStream = fs.createWriteStream(logFilePath, { flags: "a" });
app.use(express.json({ limit: "2mb" }));

// Env
const CUSTOM_LLM_URL = process.env.CUSTOM_LLM_URL || ""; // can be host or full endpoint
const CUSTOM_LLM_KEY = (process.env.CUSTOM_LLM_KEY || "").trim();
const PROXY_KEY = (process.env.PROXY_KEY || "").trim();
const PORT = Number(process.env.PORT || 3000);

function inputToMessages(input) {
  // Responses API allows: input = string OR array (message-like objects)
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }

  if (Array.isArray(input)) {
    const messages = [];

    for (const m of input) {
      // Handle function_call (assistant's tool call) - Responses API format
      if (m?.type === "function_call") {
        // Convert to Chat Completions format: assistant message with tool_calls
        messages.push({
          role: "assistant",
          content: "",
          tool_calls: [{
            id: m.call_id,
            type: "function",
            function: {
              name: m.name,
              arguments: m.arguments || ""
            }
          }]
        });
        continue;
      }

      // Handle function_call_output (tool result) - Responses API format
      if (m?.type === "function_call_output") {
        // Convert to Chat Completions format: tool message
        messages.push({
          role: "tool",
          tool_call_id: m.call_id,
          content: typeof m.output === "string" ? m.output : JSON.stringify(m.output)
        });
        continue;
      }

      // Handle regular message type
      if (m?.type === "message" || m?.role) {
        if (typeof m?.content === "string") {
          messages.push({ role: m.role || "user", content: m.content });
          continue;
        }

        // If content is array of parts, try to extract text
        if (Array.isArray(m?.content)) {
          const texts = m.content
            .map((p) => (p?.type === "input_text" || p?.type === "text" || p?.type === "output_text") ? p.text : null)
            .filter(Boolean);
          messages.push({ role: m.role || "user", content: texts.join("") });
          continue;
        }

        messages.push({ role: m?.role || "user", content: String(m?.content ?? "") });
        continue;
      }

      // Fallback for unknown types
      messages.push({ role: "user", content: String(m?.content ?? m ?? "") });
    }

    return messages;
  }

  // Fallback
  return [{ role: "user", content: String(input ?? "") }];
}

function normalizeTools(tools) {
  if (!Array.isArray(tools)) return undefined;

  const out = [];
  for (const t of tools) {
    if (!t || typeof t !== "object") continue;

    // Only forward function tools to LiteLLM (others like "web_search", "computer", "mcp", etc. will break)
    if (t.type !== "function") continue;

    // OpenAI ChatCompletions expects: { type:"function", function:{ name, description, parameters } }
    if (t.function && typeof t.function === "object") {
      out.push(t);
      continue;
    }

    // Responses-style / alternative shape: { type:"function", name, description, parameters }
    if (t.name) {
      out.push({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      });
      continue;
    }

    // Some SDKs might send: { type:"function", ... without name } -> drop it
  }

  return out;
}

function normalizeToolChoice(tool_choice) {
  if (!tool_choice) return undefined;
  if (typeof tool_choice === "string") return tool_choice;

  // ChatCompletions format: { type:"function", function:{ name:"..." } }
  if (tool_choice.type === "function") {
    if (tool_choice.function?.name) return tool_choice;
    if (tool_choice.name) {
      return { type: "function", function: { name: tool_choice.name } };
    }
  }
  return tool_choice;
}


async function callUpstreamSSEOnly({ reqId, upstreamChatUrl, body }) {
  const payload = { ...body, stream: true };
  const t0 = Date.now();

  log("info", "upstream_payload", {
    reqId,
    url: upstreamChatUrl,
    payload: safePreview(payload, 3000)
  });

  const r = await fetch(upstreamChatUrl, {
    method: "POST",
    headers: { ...authHeadersForUpstream(), accept: "text/event-stream" },
    body: JSON.stringify(payload),
  });

  const ct = r.headers.get("content-type") || "";
  log("info", "upstream_response_headers", {
    reqId,
    url: upstreamChatUrl,
    attempt: "sse",
    status: r.status,
    ms: Date.now() - t0,
    contentType: ct,
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    log("error", "upstream_error", {
      reqId,
      attempt: "sse",
      status: r.status,
      body_preview: safePreview(errText, 2000),
    });
    return { ok: false, status: r.status, ct, text: errText, mode: "sse" };
  }

  if (!ct.includes("text/event-stream")) {
    const text = await r.text().catch(() => "");
    log("error", "expected_sse_got_non_sse", {
      reqId,
      contentType: ct,
      body_preview: safePreview(text, 2000),
    });
    return { ok: false, status: 502, ct, text, mode: "sse" };
  }

  const assembled = await readSSEAndAssembleChatCompletion(r, reqId);
  return { ok: true, ct, assembled, mode: "sse" };
}



// ---------- Logging ----------
function ts() {
  return new Date().toISOString();
}
function safePreview(val, max = 1200) {
  if (val == null) return null;
  const s = typeof val === "string" ? val : JSON.stringify(val);
  return s.length > max ? s.slice(0, max) + `…(+${s.length - max} chars)` : s;
}
function log(level, msg, meta = {}) {
  const logEntry = JSON.stringify({ ts: ts(), level, msg, ...meta });
  console.log(logEntry);
  logStream.write(logEntry + "\n");
}

// Request logging middleware
app.use((req, res, next) => {
  req.reqId = crypto.randomBytes(8).toString("hex");
  req._startMs = Date.now();

  log("info", "incoming_request", {
    reqId: req.reqId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    ua: req.get("user-agent"),
    contentType: req.get("content-type"),
  });

  // Capture original res.json to log response bodies
  const originalJson = res.json.bind(res);
  res.json = function(body) {
    log("info", "response_body", {
      reqId: req.reqId,
      status: res.statusCode,
      body: safePreview(body, 2000)
    });
    return originalJson(body);
  };

  res.on("finish", () => {
    log("info", "request_finished", {
      reqId: req.reqId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - req._startMs,
    });
  });

  next();
});

// ---------- URL helpers ----------
function ensureUrl(input) {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function upstreamUrlFor(pathname) {
  if (!CUSTOM_LLM_URL) return null;
  const u = ensureUrl(CUSTOM_LLM_URL);
  if (!u) return null;

  // If CUSTOM_LLM_URL is just a host (or "/"), append pathname
  const looksLikeHostOnly = u.pathname === "/" || u.pathname === "" || u.pathname == null;

  if (looksLikeHostOnly) {
    const full = new URL(u.toString());
    full.pathname = pathname;
    return full.toString();
  }

  // If user provided a full endpoint URL, use it for chat completions
  if (pathname === "/v1/chat/completions") return u.toString();

  // Otherwise use origin + pathname
  const base = new URL(u.origin);
  base.pathname = pathname;
  return base.toString();
}

function authHeadersForUpstream() {
  return {
    "content-type": "application/json",
    ...(CUSTOM_LLM_KEY ? { authorization: `Bearer ${CUSTOM_LLM_KEY}` } : {}),
  };
}

// ---------- JSON extraction for json_object mode ----------
function extractProbablyJSON(text) {
  if (!text) return null;
  const s = text.trim();

  if (
    (s.startsWith("{") && s.endsWith("}")) ||
    (s.startsWith("[") && s.endsWith("]"))
  ) {
    try {
      return JSON.parse(s);
    } catch {}
  }

  const firstObj = s.indexOf("{");
  const firstArr = s.indexOf("[");
  let start = -1, open = null, close = null;

  if (firstObj !== -1 && (firstArr === -1 || firstObj < firstArr)) {
    start = firstObj; open = "{"; close = "}";
  } else if (firstArr !== -1) {
    start = firstArr; open = "["; close = "]";
  }
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === open) depth++;
    if (ch === close) depth--;
    if (depth === 0) {
      const candidate = s.slice(start, i + 1);
      try { return JSON.parse(candidate); } catch { return null; }
    }
  }
  return null;
}

// ---------- SSE handling (LiteLLM returning text/event-stream) ----------
async function readSSEAndAssembleChatCompletion(upstreamResp, reqId) {
  // We build a normal non-stream OpenAI chat.completion object
  // Always use chatcmpl- prefix for Chat Completions API compatibility
  let id = `chatcmpl-${crypto.randomBytes(12).toString("hex")}`;
  let model = "custom-llm";
  let created = Math.floor(Date.now() / 1000);

  let content = "";
  let reasoning_content = ""; // Separate field for thinking/reasoning
  let finish_reason = "stop";
  let lastFullObject = null;
  let tool_calls = []; // Track tool calls being assembled
  let usage = null; // Track usage info from upstream

  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  // Node fetch body is a web ReadableStream; async iteration works in Node 18+
  for await (const chunk of upstreamResp.body) {
    buffer += decoder.decode(chunk, { stream: true });

    // SSE events are separated by blank line, but easiest: process line-by-line
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trimEnd();
      buffer = buffer.slice(idx + 1);

      // We only care about data: lines
      if (!line.startsWith("data:")) continue;

      const data = line.slice(5).trim();
      if (!data) continue;

      if (data === "[DONE]") {
        log("info", "sse_done", {
          reqId,
          assembled_content_length: content.length,
          reasoning_content_length: reasoning_content.length,
          tool_calls_count: tool_calls.length
        });

        const message = { role: "assistant", content };
        if (reasoning_content) {
          message.reasoning_content = reasoning_content;
        }
        if (tool_calls.length > 0) {
          message.tool_calls = tool_calls;
        }

        const result = {
          id,
          object: "chat.completion",
          created,
          model,
          choices: [
            {
              index: 0,
              message,
              finish_reason,
            },
          ],
        };
        if (usage) result.usage = usage;
        return lastFullObject ?? result;
      }

      let obj;
      try {
        obj = JSON.parse(data);
      } catch (e) {
        log("warn", "sse_bad_json", { reqId, data_preview: safePreview(data, 300) });
        continue;
      }

      // Log each SSE event for debugging
      log("info", "sse_event", {
        reqId,
        event: safePreview(obj, 500),
        has_choices: Boolean(obj?.choices),
        has_message: Boolean(obj?.choices?.[0]?.message),
        has_delta: Boolean(obj?.choices?.[0]?.delta)
      });

      // Keep metadata if present (but always use chatcmpl- prefix for ID)
      // Don't override id - keep our chatcmpl- format for compatibility
      if (obj?.model) model = obj.model;
      if (obj?.created) created = obj.created;
      if (obj?.usage) usage = obj.usage;

      // Some providers stream full objects sometimes
      if (obj?.choices?.[0]?.message?.content != null) {
        log("info", "sse_full_message", { reqId, content_length: obj.choices[0].message.content.length });
        lastFullObject = obj;
        continue;
      }

      // Standard OpenAI streaming delta format
      const ch0 = obj?.choices?.[0];
      if (ch0?.finish_reason) {
        log("info", "sse_finish_reason", { reqId, finish_reason: ch0.finish_reason });
        finish_reason = ch0.finish_reason;
      }

      const delta = ch0?.delta;
      if (delta?.content) {
        log("info", "sse_delta_content", { reqId, delta_length: delta.content.length, total_length: content.length + delta.content.length });
        content += delta.content;
      }

      // Some providers use delta.text
      if (delta?.text) {
        log("info", "sse_delta_text", { reqId, delta_length: delta.text.length, total_length: content.length + delta.text.length });
        content += delta.text;
      }

      // Handle reasoning_content (used by o1, DeepSeek, and similar reasoning models)
      // Collect separately - don't mix with main content
      if (delta?.reasoning_content) {
        log("info", "sse_delta_reasoning", { reqId, delta_length: delta.reasoning_content.length, total_length: reasoning_content.length + delta.reasoning_content.length });
        reasoning_content += delta.reasoning_content;
      }

      // Handle tool calls
      if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;

          // Initialize tool call if it doesn't exist
          if (!tool_calls[idx]) {
            tool_calls[idx] = {
              id: tc.id || "",
              type: tc.type || "function",
              function: {
                name: tc.function?.name || "",
                arguments: ""
              }
            };
            log("info", "sse_tool_call_start", {
              reqId,
              index: idx,
              id: tool_calls[idx].id,
              name: tool_calls[idx].function.name
            });
          }

          // Append arguments as they stream in
          if (tc.function?.arguments) {
            tool_calls[idx].function.arguments += tc.function.arguments;
            log("info", "sse_tool_call_args", {
              reqId,
              index: idx,
              args_chunk_length: tc.function.arguments.length,
              total_args_length: tool_calls[idx].function.arguments.length
            });
          }
        }
      }
    }
  }

  // If stream ended without [DONE]
  log("warn", "sse_ended_without_done", {
    reqId,
    assembled_content_length: content.length,
    reasoning_content_length: reasoning_content.length,
    tool_calls_count: tool_calls.length
  });

  const message = { role: "assistant", content };
  if (reasoning_content) {
    message.reasoning_content = reasoning_content;
  }
  if (tool_calls.length > 0) {
    message.tool_calls = tool_calls;
  }

  const result = {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason,
      },
    ],
  };
  if (usage) result.usage = usage;
  return lastFullObject ?? result;
}

// ---------- Normalization helpers ----------
function normalizeOpenAIChatCompletion(upstream) {
  if (upstream?.choices?.length) return upstream;

  const rawText =
    upstream?.text ??
    upstream?.output ??
    upstream?.result ??
    upstream?.message ??
    "";

  return {
    id: `chatcmpl_${crypto.randomBytes(12).toString("hex")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: upstream?.model ?? "custom-llm",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: String(rawText ?? "") },
        finish_reason: "stop",
      },
    ],
    usage: upstream?.usage,
  };
}

function getAssistantText(out) {
  const c0 = out?.choices?.[0];
  if (!c0) return "";
  if (c0.message?.content != null) return String(c0.message.content);
  if (c0.text != null) return String(c0.text);
  return "";
}

function setAssistantText(out, text) {
  if (!out?.choices?.[0]) return;
  if (!out.choices[0].message) out.choices[0].message = { role: "assistant" };
  out.choices[0].message.role = out.choices[0].message.role || "assistant";
  out.choices[0].message.content = text;
}

// ---------- Endpoints ----------
app.get("/health", (req, res) => res.json({ ok: true }));

// Health check endpoints for Cursor and other clients
app.get("/", (req, res) => res.json({ status: "ok", service: "llm-openai-proxy" }));
app.head("/", (req, res) => res.status(200).end());
app.get("/v1", (req, res) => res.json({ status: "ok" }));
app.head("/v1", (req, res) => res.status(200).end());

app.post("/v1/responses", async (req, res) => {
  try {
    log("info", "request_body", {
      reqId: req.reqId,
      body: safePreview(req.body, 2000)
    });

    if (PROXY_KEY) {
      const key = (req.get("x-proxy-key") || "").trim();
      if (key !== PROXY_KEY) {
        log("warn", "auth_failed", { reqId: req.reqId });
        return res.status(401).json({ error: { message: "Unauthorized" } });
      }
    }

    const body = req.body || {};
    const {
      model,
      input,
      instructions,
      temperature,
      top_p,
      max_output_tokens,
      previous_response_id,
      store,
      tools,
      tool_choice,
      parallel_tool_calls,
      text,         // { format: { type: "text" | "json_object" | "json_schema", ... } }
      // stream (Responses supports streaming, but we keep this proxy non-stream JSON for n8n)
    } = body;

    const messages = inputToMessages(input);
    if (!messages.length) {
      return res.status(400).json({ error: { message: "input is required" } });
    }
    if (!model) {
      return res.status(400).json({ error: { message: "model is required" } });
    }

    // Map Responses "text.format" → ChatCompletions "response_format"
    let response_format = undefined;

    const fmt = text?.format?.type;
    if (fmt === "json_object") {
      response_format = { type: "json_object" };
    } else if (fmt === "json_schema") {
      // Responses uses: text.format = { type:"json_schema", name, strict, schema }
      response_format = {
        type: "json_schema",
        json_schema: {
          name: text?.format?.name || "schema",
          strict: text?.format?.strict ?? true,
          schema: text?.format?.schema,
        },
      };
    }

    // Build upstream Chat Completions request
const chatReq = {
  model,
  messages,
  stream: false,
  temperature,
  top_p,
  max_tokens: max_output_tokens,

  // ✅ normalize before forwarding
  tools: normalizeTools(tools),
  tool_choice: normalizeToolChoice(tool_choice),
  parallel_tool_calls,

  response_format,
};

    // If instructions provided, prepend as system msg (simple + effective)
    if (instructions) {
      chatReq.messages = [{ role: "system", content: instructions }, ...chatReq.messages];
    }

    const upstreamChatUrl = upstreamUrlFor("/v1/chat/completions");
    if (!upstreamChatUrl) {
      return res.status(500).json({ error: { message: "CUSTOM_LLM_URL is not set/invalid" } });
    }

    // Use your existing JSON→SSE fallback (because LiteLLM may return JSON null otherwise)
const result = await callUpstreamSSEOnly({ reqId: req.reqId, upstreamChatUrl, body: chatReq });

    if (!result.ok) {
      return res.status(502).json({
        error: {
          message: "Upstream custom LLM error",
          upstream_status: result.status,
          upstream_content_type: result.ct,
          upstream_body: result.text,
          upstream_mode: result.mode,
        },
      });
    }

    // Extract assistant text and tool_calls from upstream (either JSON or assembled SSE)
    let assistantText = "";
    let assistantToolCalls = [];
    let usage = undefined;
    let upstreamModel = model;

    if (result.mode === "sse") {
      // assembled chat.completion object
      const out = result.assembled;
      upstreamModel = out.model || upstreamModel;
      usage = out.usage;
      assistantText = out?.choices?.[0]?.message?.content || "";
      assistantToolCalls = out?.choices?.[0]?.message?.tool_calls || [];
    } else {
      const upstreamJson = JSON.parse(result.text);
      upstreamModel = upstreamJson?.model || upstreamModel;
      usage = upstreamJson?.usage;
      assistantText =
        upstreamJson?.choices?.[0]?.message?.content ??
        upstreamJson?.choices?.[0]?.text ??
        "";
      assistantToolCalls = upstreamJson?.choices?.[0]?.message?.tool_calls || [];
    }

    // If Responses requested JSON output, optionally “fix” it (best-effort)
    if (fmt === "json_object") {
      const parsed = extractProbablyJSON(assistantText);
      if (parsed) assistantText = JSON.stringify(parsed);
    }

    // Build OpenAI Responses-style Response object :contentReference[oaicite:2]{index=2}
    const respId = `resp_${crypto.randomBytes(24).toString("hex")}`;
    const msgId = `msg_${crypto.randomBytes(24).toString("hex")}`;
    const created_at = Math.floor(Date.now() / 1000);

    // Build output array - message first, then function_calls as separate items
    const outputArray = [];

    // Add message with text content
    const contentArray = [];
    if (assistantText) {
      contentArray.push({
        type: "output_text",
        text: assistantText,
        annotations: [],
      });
    }

    outputArray.push({
      type: "message",
      id: msgId,
      status: "completed",
      role: "assistant",
      content: contentArray,
    });

    // Add tool calls as separate items in output (NOT inside content!)
    if (assistantToolCalls && assistantToolCalls.length > 0) {
      for (const tc of assistantToolCalls) {
        outputArray.push({
          type: "function_call",
          call_id: tc.id,  // Responses API uses call_id, not id
          name: tc.function?.name || "",
          arguments: tc.function?.arguments || "",
        });
      }
    }

    const responseObj = {
      id: respId,
      object: "response",
      created_at,
      status: "completed",
      error: null,
      incomplete_details: null,
      instructions: instructions ?? null,
      max_output_tokens: max_output_tokens ?? null,
      model: upstreamModel,

      output: outputArray,

      parallel_tool_calls: parallel_tool_calls ?? true,
      previous_response_id: previous_response_id ?? null,

      reasoning: { effort: null, summary: null },

      store: store ?? true,
      temperature: temperature ?? 1,
      text: text ?? { format: { type: "text" } },
      tool_choice: tool_choice ?? "auto",
      tools: tools ?? [],
      top_p: top_p ?? 1,
      truncation: "disabled",
      usage: usage ?? null,
      user: null,
      metadata: body.metadata ?? {},
      // optional convenience (not in example JSON, but handy for n8n)
      output_text: assistantText,
    };

    log("info", "response_object_built", {
      reqId: req.reqId,
      respId,
      msgId,
      output_text_length: assistantText.length,
      output_text_preview: safePreview(assistantText, 200),
      model: upstreamModel,
      usage,
    });

    return res.json(responseObj);
  } catch (e) {
    log("error", "responses_handler_error", {
      reqId: req.reqId,
      err: String(e?.stack || e?.message || e),
    });
    return res.status(500).json({ error: { message: "Proxy error", detail: String(e?.message ?? e) } });
  }
});


app.get("/v1/models", async (req, res) => {
  const url = upstreamUrlFor("/v1/models");
  if (!url) return res.status(500).json({ error: { message: "CUSTOM_LLM_URL is not set/invalid" } });

  try {
    log("info", "upstream_request", { reqId: req.reqId, url });

    const r = await fetch(url, { headers: authHeadersForUpstream() });
    const t = await r.text();

    log("info", "upstream_response", {
      reqId: req.reqId,
      url,
      status: r.status,
      contentType: r.headers.get("content-type"),
      body_preview: safePreview(t, 1200),
    });

    if (!r.ok) throw new Error(`Upstream /v1/models failed: ${r.status}`);

    return res.status(200).set("content-type", "application/json").send(t);
  } catch (e) {
    log("warn", "models_fallback", { reqId: req.reqId, err: String(e?.message ?? e) });
    return res.json({
      object: "list",
      data: [{ id: "custom-llm", object: "model", created: Math.floor(Date.now() / 1000), owned_by: "proxy" }],
    });
  }
});

app.post("/v1/chat/completions", async (req, res) => {
  try {
    log("info", "request_body", {
      reqId: req.reqId,
      body: safePreview(req.body, 2000)
    });

    if (PROXY_KEY) {
      const key = (req.get("x-proxy-key") || "").trim();
      if (key !== PROXY_KEY) {
        log("warn", "auth_failed", { reqId: req.reqId });
        return res.status(401).json({ error: { message: "Unauthorized" } });
      }
    }

    const upstreamChatUrl = upstreamUrlFor("/v1/chat/completions");
    if (!upstreamChatUrl) {
      return res.status(500).json({ error: { message: "CUSTOM_LLM_URL is not set/invalid" } });
    }

    const body = req.body || {};
    const wantsStreaming = body.stream === true;

    // Accept either messages (Chat Completions) or input (Responses API format)
    let messages = body.messages;
    if ((!Array.isArray(messages) || messages.length === 0) && body.input) {
      // Convert Responses API "input" to Chat Completions "messages"
      messages = inputToMessages(body.input);
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: "messages[] is required" } });
    }

    // Replace body.messages with normalized messages and remove input
    body.messages = messages;
    delete body.input;  // Remove Responses API field - upstream expects only messages

    // Normalize tools and tool_choice (Responses API format -> Chat Completions format)
    if (body.tools) {
      body.tools = normalizeTools(body.tools);
    }
    if (body.tool_choice) {
      body.tool_choice = normalizeToolChoice(body.tool_choice);
    }

    log("info", "upstream_request", {
      reqId: req.reqId,
      url: upstreamChatUrl,
      streaming: wantsStreaming,
      payload_preview: safePreview({ ...body }, 1400),
    });

    // ========== STREAMING MODE ==========
    if (wantsStreaming) {
      return await handleStreamingRequest(req, res, upstreamChatUrl, body);
    }

    // ========== NON-STREAMING MODE ==========
    const result = await callUpstreamSSEOnly({
      reqId: req.reqId,
      upstreamChatUrl,
      body,
    });

    if (!result.ok) {
      return res.status(502).json({
        error: {
          message: "Upstream custom LLM error",
          upstream_status: result.status,
          upstream_content_type: result.ct,
          upstream_body: result.text,
          upstream_mode: result.mode,
        },
      });
    }

    // Build output object
    let out;
    if (result.mode === "sse") {
      out = result.assembled; // already OpenAI-like chat.completion
    } else {
      // JSON mode: parse and normalize
      let upstreamJson;
      try {
        upstreamJson = JSON.parse(result.text);
      } catch {
        upstreamJson = { text: result.text };
      }

      if (upstreamJson === null) {
        // Shouldn't happen because we fallback, but keep safe
        return res.status(502).json({ error: { message: "Upstream returned JSON null" } });
      }

      out = normalizeOpenAIChatCompletion(upstreamJson);
    }

    // Optional: n8n JSON mode fix
    const wantsJsonObject = body?.response_format?.type === "json_object";
    if (wantsJsonObject) {
      const assistantText = getAssistantText(out);
      const parsed = extractProbablyJSON(assistantText);
      if (parsed) {
        setAssistantText(out, JSON.stringify(parsed));
        out.proxy_debug = { ...(out.proxy_debug || {}), json_mode: true, json_parsed: true };
      } else {
        out.proxy_debug = { ...(out.proxy_debug || {}), json_mode: true, json_parsed: false };
      }
    }

    out.object = out.object || "chat.completion";
    out.created = out.created || Math.floor(Date.now() / 1000);
    out.id = out.id || `chatcmpl-${crypto.randomBytes(12).toString("hex")}`;

    log("info", "response_normalized", {
      reqId: req.reqId,
      id: out.id,
      model: out.model,
      choices0_preview: safePreview(getAssistantText(out), 1200),
      json_mode: Boolean(wantsJsonObject),
      used_upstream: result.mode,
    });

    return res.json(out);
  } catch (e) {
    log("error", "handler_error", { reqId: req.reqId, err: String(e?.stack || e?.message || e) });
    return res.status(500).json({ error: { message: "Proxy error", detail: String(e?.message ?? e) } });
  }
});

// Streaming handler - forwards SSE from upstream to client
async function handleStreamingRequest(req, res, upstreamChatUrl, body) {
  const reqId = req.reqId;
  const t0 = Date.now();

  // Always request streaming from upstream
  const payload = { ...body, stream: true };

  log("info", "streaming_upstream_request", {
    reqId,
    url: upstreamChatUrl,
  });

  const upstreamResp = await fetch(upstreamChatUrl, {
    method: "POST",
    headers: { ...authHeadersForUpstream(), accept: "text/event-stream" },
    body: JSON.stringify(payload),
  });

  const ct = upstreamResp.headers.get("content-type") || "";
  log("info", "streaming_upstream_response", {
    reqId,
    status: upstreamResp.status,
    ms: Date.now() - t0,
    contentType: ct,
  });

  if (!upstreamResp.ok) {
    const errText = await upstreamResp.text().catch(() => "");
    log("error", "streaming_upstream_error", {
      reqId,
      status: upstreamResp.status,
      body_preview: safePreview(errText, 2000),
    });
    return res.status(502).json({
      error: {
        message: "Upstream error",
        upstream_status: upstreamResp.status,
        upstream_body: errText,
      },
    });
  }

  // Set SSE headers for client
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
  res.flushHeaders();

  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let eventCount = 0;

  // Generate our own chatcmpl- ID for consistency
  const proxyId = `chatcmpl-${crypto.randomBytes(12).toString("hex")}`;

  try {
    for await (const chunk of upstreamResp.body) {
      buffer += decoder.decode(chunk, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trimEnd();
        buffer = buffer.slice(idx + 1);

        // Pass through empty lines (SSE format)
        if (line === "") {
          res.write("\n");
          continue;
        }

        // Pass through non-data lines (comments, event types)
        if (!line.startsWith("data:")) {
          res.write(line + "\n");
          continue;
        }

        const data = line.slice(5).trim();
        if (!data) {
          res.write("data:\n");
          continue;
        }

        // Handle [DONE] signal
        if (data === "[DONE]") {
          res.write("data: [DONE]\n\n");
          log("info", "streaming_done", { reqId, eventCount, ms: Date.now() - t0 });
          continue;
        }

        // Parse and transform the SSE event
        let obj;
        try {
          obj = JSON.parse(data);
        } catch {
          // Pass through unparseable data as-is
          res.write(`data: ${data}\n`);
          continue;
        }

        // Transform the event:
        // 1. Replace ID with our chatcmpl- format
        // 2. Convert reasoning_content to content
        if (obj.id) {
          obj.id = proxyId;
        }

        // Keep reasoning_content separate - don't convert to content
        // Clients that support reasoning models will handle it properly

        // Write transformed event
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
        eventCount++;
      }
    }

    // Handle any remaining buffer
    if (buffer.trim()) {
      res.write(`data: ${buffer}\n\n`);
    }

    log("info", "streaming_complete", { reqId, eventCount, ms: Date.now() - t0 });
    res.end();
  } catch (e) {
    log("error", "streaming_error", { reqId, err: String(e?.message || e) });
    // Try to send error if connection still open
    try {
      res.write(`data: ${JSON.stringify({ error: { message: "Stream error", detail: String(e?.message || e) } })}\n\n`);
      res.end();
    } catch {
      // Connection already closed
    }
  }
}


// Global crash logs
process.on("unhandledRejection", (reason) => {
  log("error", "unhandledRejection", { reason: safePreview(reason, 4000) });
});
process.on("uncaughtException", (err) => {
  log("error", "uncaughtException", { err: safePreview(err?.stack || String(err), 4000) });
  process.exit(1);
});

// Listen
const server = app.listen(PORT, "0.0.0.0", () => {
  log("info", "listening", { port: PORT, logFile: logFilePath });
  console.log(`\n📝 Logs are being written to: ${logFilePath}\n`);
});
server.on("error", (err) => {
  log("error", "listen_error", { err: String(err?.message ?? err) });
  process.exit(1);
});

// Cleanup log stream on exit
process.on("SIGINT", () => {
  log("info", "shutting_down", { signal: "SIGINT" });
  logStream.end();
  process.exit(0);
});
process.on("SIGTERM", () => {
  log("info", "shutting_down", { signal: "SIGTERM" });
  logStream.end();
  process.exit(0);
});
