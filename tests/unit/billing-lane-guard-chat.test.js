// FluxLabs billing-lane guard: the predicate, and the chat handler refusing a
// forbidden OpenRouter lane with a 403 before any credential lookup, directly,
// through a model alias, and as a combo member (where failover continues).
import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => ({
  combos: [
    { id: "c1", name: "Mixed", models: ["openrouter/openai/gpt-5.5-pro", "openrouter/x-ai/grok-4.6"] },
  ],
  aliases: { "big-gpt": "openrouter/openai/gpt-5.5-pro" },
}));
const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  handleChatCore: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false, comboStrategy: "fallback" }),
  getModelAliases: async () => fx.aliases,
  getComboByName: async (name) => fx.combos.find((c) => c.name === name) || null,
  getProviderNodes: async () => [],
  getCombos: async () => fx.combos,
  getProviderConnections: async () => [],
  getProviderConnectionById: async () => null,
  getCustomModels: async () => [],
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => fx.combos }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async () => null }));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: vi.fn() }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(),
  extractApiKey: () => null,
  isValidApiKey: async () => true,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_p, c) => c,
  updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));

const { isForbiddenBillingLane, billingLaneDeniedMessage } = await import("../../src/shared/constants/billingLane.js");
const { handleChat } = await import("../../src/sse/handlers/chat.js");

const enc = new TextEncoder();
const sse = (frames) => new Response(new ReadableStream({
  start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close(); },
}), { status: 200, headers: { "Content-Type": "text/event-stream" } });
const CONTENT = (t) => `data: {"id":"x","choices":[{"index":0,"delta":{"content":"${t}"},"finish_reason":null}]}\n\n`;

const chat = (model) => handleChat(new Request("http://localhost/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model, stream: true, messages: [{ role: "user", content: "hi" }] }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProviderCredentials.mockResolvedValue({ connectionId: "conn", connectionName: "mock" });
  mocks.handleChatCore.mockImplementation(async ({ modelInfo }) => ({
    success: true, response: sse([CONTENT(`from-${modelInfo.model}`), "data: [DONE]\n\n"]),
  }));
});

describe("isForbiddenBillingLane", () => {
  it("refuses metered GPT and Gemini on openrouter, any case", () => {
    for (const m of ["openai/gpt-5.5-pro", "openai/gpt-5.5", "OpenAI/GPT-6-astra", "google/gemini-3.5-flash",
      "Google/Gemini-3.8-Flash", " openai/gpt-chat-latest"]) {
      expect(isForbiddenBillingLane("openrouter", m), m).toBe(true);
      expect(isForbiddenBillingLane("OpenRouter", m), m).toBe(true);
    }
  });
  it("allows gpt-oss, Gemma, Grok and other families on openrouter", () => {
    for (const m of ["openai/gpt-oss-120b", "openai/gpt-oss-120b:free", "google/gemma-4-31b-it",
      "x-ai/grok-4.6", "meta/muse-spark-1.3", "anthropic/claude-x", "", null]) {
      expect(isForbiddenBillingLane("openrouter", m), String(m)).toBe(false);
    }
  });
  it("never touches other providers", () => {
    for (const p of ["codex", "antigravity", "vertex", "openai", "gemini", null]) {
      expect(isForbiddenBillingLane(p, "openai/gpt-5.5-pro")).toBe(false);
      expect(isForbiddenBillingLane(p, "google/gemini-3.5-flash")).toBe(false);
    }
  });
  it("names the rule and the right lanes in the client message", () => {
    expect(billingLaneDeniedMessage("openai/gpt-5.5-pro")).toMatch(/billing-lane guard.*cx\/.*ag\/ or vertex\//);
  });
});

describe("chat handler", () => {
  it("403s a forbidden lane before any credential lookup", async () => {
    for (const m of ["openrouter/openai/gpt-5.5-pro", "openrouter/google/gemini-3.5-flash"]) {
      const r = await chat(m);
      expect(r.status, m).toBe(403);
      expect(JSON.stringify(await r.json())).toContain("billing-lane guard");
    }
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });
  it("403s a model alias that resolves to a forbidden lane", async () => {
    expect((await chat("big-gpt")).status).toBe(403);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });
  it("serves allowed openrouter lanes", async () => {
    for (const m of ["openrouter/x-ai/grok-4.6", "openrouter/google/gemma-4-31b-it", "openrouter/openai/gpt-oss-120b"]) {
      expect((await chat(m)).status, m).toBe(200);
    }
  });
  it("a combo never calls its forbidden member and still reaches the allowed one", async () => {
    const r = await chat("Mixed");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("from-x-ai/grok-4.6");
    const called = mocks.getProviderCredentials.mock.calls.map(([p, , m]) => `${p}/${m}`);
    expect(called).not.toContain("openrouter/openai/gpt-5.5-pro");
    expect(called).toContain("openrouter/x-ai/grok-4.6");
  });
});
