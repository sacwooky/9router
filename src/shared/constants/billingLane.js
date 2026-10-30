// FluxLabs billing-lane guard: OpenRouter models that must never be served.
//
// The model-id prefix selects the billing lane. GPT through OpenRouter is
// metered premium (one day of `openrouter/openai/gpt-5.5-pro` cost $50) and
// belongs on `cx/`; Gemini through OpenRouter belongs on `ag/` or `vertex/`.
// The free `openai/gpt-oss-*` tier and every other family (Gemma, Grok, ...)
// stay allowed. Same predicate as the fleet's config gate
// (substrate gates/model-lane-prefixes.py), applied to the RESOLVED
// provider/model so no alias or casing can reach the metered lane.

const FORBIDDEN_OPENROUTER_MODEL = /^(?:openai\/gpt-(?!oss-)|google\/gemini)/i;

/** True when `providerId` (already resolved) + `model` is a forbidden lane. */
export function isForbiddenBillingLane(providerId, model) {
  if (String(providerId || "").toLowerCase() !== "openrouter") return false;
  return FORBIDDEN_OPENROUTER_MODEL.test(String(model || "").trim());
}

// Client-facing 403 message. Names the rule and the right lane, nothing else.
export function billingLaneDeniedMessage(model) {
  return `Model "openrouter/${model}" is blocked by the FluxLabs billing-lane guard: ` +
    "use cx/ for GPT and ag/ or vertex/ for Gemini";
}
