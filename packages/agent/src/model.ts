import {
  createOpenRouter,
  OpenRouterProvider,
} from "@openrouter/ai-sdk-provider";
import { getEnv } from "./env";

let openRouter: OpenRouterProvider | undefined;

export function getOpenRouter() {
  if (!openRouter)
    openRouter = createOpenRouter({
      apiKey: getEnv().OPENROUTER_API_KEY,
      baseURL: getEnv().OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    });
  return openRouter;
}

export function getModelName() {
  return getEnv().AGENT_MODEL || "openai/gpt-oss-120b";
}
