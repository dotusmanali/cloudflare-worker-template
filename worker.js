/**
 * ============================================================
 *  Cloudflare AI Worker — Universal LLM API Proxy
 *  Author: Usman Ali  |  github.com/dotusmanali
 * ============================================================
 *
 *  FEATURES:
 *  - OpenAI-compatible API format (messages array)
 *  - Bearer token authentication (your own secret key)
 *  - CORS enabled — works from any frontend / make.com / n8n
 *  - Supports all Cloudflare Workers AI models
 *  - System prompt support
 *  - Streaming + non-streaming responses
 *
 *  DEPLOY:
 *  1. Copy this file to your Cloudflare Worker
 *  2. Set environment variable:  API_KEY = your-secret-key
 *  3. Enable Workers AI binding:  name = AI
 *  4. Deploy → get your Worker URL
 *  5. Use URL + API key in make.com / any backend
 *
 * ============================================================
 */

// ─── Default Configuration ───────────────────────────────────────────────────

const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// List of supported Cloudflare AI models
const ALLOWED_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct",
  "@cf/meta/llama-3.1-70b-instruct",
  "@cf/mistral/mistral-7b-instruct-v0.1",
  "@cf/google/gemma-7b-it",
  "@cf/qwen/qwen1.5-7b-chat-awq",
  "@cf/microsoft/phi-2",
];

// ─── CORS Headers ─────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

// ─── Main Handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health check — GET /
    if (request.method === "GET") {
      return jsonResponse({
        status: "ok",
        name: "Cloudflare AI Worker",
        models: ALLOWED_MODELS,
        usage: {
          endpoint: "POST /",
          headers: {
            "Authorization": "Bearer YOUR_API_KEY",
            "Content-Type": "application/json",
          },
          body: {
            model: DEFAULT_MODEL,
            messages: [
              { role: "system", content: "You are a helpful assistant." },
              { role: "user", content: "Hello!" },
            ],
            max_tokens: 1024,
            stream: false,
          },
        },
      });
    }

    // Only allow POST for inference
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // ── Authentication ──────────────────────────────────────────────────────
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!env.API_KEY) {
      return jsonResponse({ error: "Server misconfigured: API_KEY not set" }, 500);
    }

    if (token !== env.API_KEY) {
      return jsonResponse({ error: "Unauthorized — invalid API key" }, 401);
    }

    // ── Parse Request Body ──────────────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const { messages, model, max_tokens, temperature, stream } = body;

    // Validate messages
    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonResponse({ error: "messages array is required" }, 400);
    }

    // Select model (default if not provided or not in allowed list)
    const selectedModel = ALLOWED_MODELS.includes(model) ? model : DEFAULT_MODEL;

    // ── Run AI Inference ────────────────────────────────────────────────────
    try {
      if (stream === true) {
        // Streaming response
        const response = await env.AI.run(selectedModel, {
          messages,
          max_tokens: max_tokens || 2048,
          temperature: temperature || 0.7,
          stream: true,
        });

        return new Response(response, {
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      } else {
        // Non-streaming response
        const result = await env.AI.run(selectedModel, {
          messages,
          max_tokens: max_tokens || 2048,
          temperature: temperature || 0.7,
        });

        return jsonResponse({
          id: `cf-${Date.now()}`,
          object: "chat.completion",
          model: selectedModel,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: result.response || "",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: null,
            completion_tokens: null,
            total_tokens: null,
          },
        });
      }
    } catch (err) {
      console.error("AI inference error:", err);
      return jsonResponse(
        { error: "AI inference failed", detail: err.message },
        500
      );
    }
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}
