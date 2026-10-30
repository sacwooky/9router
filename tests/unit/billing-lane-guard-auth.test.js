// FluxLabs billing-lane guard backstop: the real getProviderCredentials refuses
// a forbidden OpenRouter lane without looking up any connection, so embeddings,
// images, tts and every other path that selects credentials is covered too.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(async () => []),
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({});
  mocks.getProviderConnections.mockResolvedValue([
    { id: "or-1", provider: "openrouter", isActive: true, apiKey: "test-key", priority: 1 },
  ]);
});

describe("getProviderCredentials billing-lane backstop", () => {
  it("returns null for a forbidden lane and never reads a connection", async () => {
    for (const m of ["openai/gpt-5.5-pro", "OpenAI/GPT-5.5", "google/gemini-3.5-flash"]) {
      expect(await getProviderCredentials("openrouter", null, m), m).toBeNull();
    }
    expect(mocks.getProviderConnections).not.toHaveBeenCalled();
  });
  it("still selects the openrouter connection for an allowed lane", async () => {
    for (const m of ["x-ai/grok-4.6", "google/gemma-4-31b-it", "openai/gpt-oss-120b"]) {
      const c = await getProviderCredentials("openrouter", null, m);
      expect(c?.connectionId, m).toBe("or-1");
    }
    expect(mocks.getProviderConnections).toHaveBeenCalled();
  });
});
