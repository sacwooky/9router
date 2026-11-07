import { describe, it, expect } from "vitest";
import { parseClaudeOAuthUsage } from "../../open-sse/services/usage/claude.js";

// Shape of Anthropic's live OAuth usage reply (2026-11-07, Max 20x): five_hour null, meters in limits[].
const weeklyAll = { kind: "weekly_all", group: "weekly", percent: 4, severity: "normal", resets_at: "2026-11-13T13:00:00.514616+00:00", scope: null, is_active: true };
const fable = { kind: "weekly_scoped", group: "weekly", percent: 0, resets_at: "2026-11-13T13:00:00+00:00", scope: { model: { id: null, display_name: "Fable" } }, is_active: false };
const seven = { utilization: 4, resets_at: "2026-11-13T13:00:00.514616+00:00" };

describe("parseClaudeOAuthUsage", () => {
  it("a plan with no 5-hour meter has no session (5h) quota, never a fabricated one", () => {
    const { quotas } = parseClaudeOAuthUsage({ five_hour: null, seven_day: seven, limits: [weeklyAll, fable] });
    expect(Object.keys(quotas).sort()).toEqual(["weekly (7d)", "weekly fable (7d)"]);
  });

  it("reads the 5-hour meter from a limits[] session row when five_hour is absent", () => {
    const session = { kind: "session", group: "session", percent: 37, resets_at: "2026-11-07T09:00:00+00:00", scope: null, is_active: true };
    const { quotas } = parseClaudeOAuthUsage({ five_hour: null, seven_day: seven, limits: [session, weeklyAll, fable] });
    expect(quotas["session (5h)"]).toMatchObject({ used: 37, total: 100, remaining: 63, remainingPercentage: 63, unlimited: false });
    expect(quotas["session (5h)"].resetAt).toBeTruthy();
    expect(quotas["weekly fable (7d)"]).toMatchObject({ used: 0 });
  });

  it("five_hour wins over a session row in the same reply; out-of-range percents clamp; a non-number is skipped", () => {
    const row = (percent) => ({ kind: "session", group: "session", percent, resets_at: "2026-11-07T09:00:00+00:00" });
    expect(parseClaudeOAuthUsage({ five_hour: { utilization: 12, resets_at: null }, limits: [row(90)] }).quotas["session (5h)"].used).toBe(12);
    expect(parseClaudeOAuthUsage({ limits: [row(140)] }).quotas["session (5h)"].used).toBe(100);
    expect(parseClaudeOAuthUsage({ limits: [row(-3)] }).quotas["session (5h)"].used).toBe(0);
    expect(parseClaudeOAuthUsage({ limits: [row("37")] }).quotas["session (5h)"]).toBeUndefined();
  });
});
