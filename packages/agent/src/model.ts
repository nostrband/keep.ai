import { getEnv } from "./env";

export const DEFAULT_AGENT_MODEL = "anthropic/claude-sonnet-4";
export const DEFAULT_TEXT_MODEL = "google/gemini-2.5-flash-lite";

export function getOpenRouterConfig() {
  const apiKey = getEnv().OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");
  return {
    apiKey,
    baseURL: getEnv().OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
  };
}

export function getModelName() {
  return getEnv().AGENT_MODEL || DEFAULT_AGENT_MODEL;
}

export function getTextModelName() {
  return getEnv().TEXT_MODEL || DEFAULT_TEXT_MODEL;
}
