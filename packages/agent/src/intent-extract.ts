/**
 * Intent Extraction (exec-17)
 *
 * Extracts structured intent from planner conversation messages.
 * The Intent Spec captures what a workflow is meant to do - its goals,
 * inputs, outputs, assumptions, non-goals, and semantic constraints.
 *
 * This is a separate LLM call from the main agent loop, used after
 * a script is saved to extract the user's intent from their messages.
 */

import { getEnv } from "./env";
import { getTextModelName } from "./model";
import debug from "debug";
import { IntentSpec } from "@app/db";

const debugIntent = debug("intent-extract");

/**
 * System prompt for intent extraction.
 * Focused and concise to minimize token usage.
 */
const INTENT_EXTRACTION_PROMPT = `You are extracting the user's intent from a workflow creation conversation.

Given the user's messages, extract:
1. GOAL: What outcome does the user want? (1-2 sentences, clear and specific)
2. INPUTS: What external data/events trigger or feed this workflow? (list)
3. OUTPUTS: What external effects should the workflow produce? (list)
4. ASSUMPTIONS: What defaults are implied but not stated explicitly? (list)
5. NON-GOALS: What is this workflow explicitly NOT meant to do? (list, only if mentioned)
6. SEMANTIC CONSTRAINTS: Any behavioral rules or restrictions mentioned? (list, only if mentioned)
7. TITLE: A short, descriptive title for this workflow (2-5 words, action-oriented)

Return a JSON object with these exact fields:
{
  "goal": "string",
  "inputs": ["string"],
  "outputs": ["string"],
  "assumptions": ["string"],
  "nonGoals": ["string"],
  "semanticConstraints": ["string"],
  "title": "string"
}

Be concise. If a field has no content, use an empty array. Do not invent details not present in the conversation.`;

/**
 * JSON schema for the intent extraction response.
 */
const INTENT_JSON_SCHEMA = {
  name: "intent_spec",
  strict: true,
  schema: {
    type: "object",
    properties: {
      goal: { type: "string" },
      inputs: { type: "array", items: { type: "string" } },
      outputs: { type: "array", items: { type: "string" } },
      assumptions: { type: "array", items: { type: "string" } },
      nonGoals: { type: "array", items: { type: "string" } },
      semanticConstraints: { type: "array", items: { type: "string" } },
      title: { type: "string" },
    },
    required: ["goal", "inputs", "outputs", "assumptions", "nonGoals", "semanticConstraints", "title"],
    additionalProperties: false,
  },
};

/**
 * Raw extraction result from the LLM.
 */
interface IntentExtractionResult {
  goal: string;
  inputs: string[];
  outputs: string[];
  assumptions: string[];
  nonGoals: string[];
  semanticConstraints: string[];
  title: string;
}

/**
 * Extract intent from user messages in a planner conversation.
 *
 * @param userMessages - Array of user message content strings from the conversation
 * @param taskId - The task ID this intent was extracted from
 * @returns IntentSpec object ready to be stored
 * @throws Error if extraction fails
 */
export async function extractIntent(
  userMessages: string[],
  taskId: string
): Promise<IntentSpec> {
  const env = getEnv();

  if (!env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OpenRouter API key not configured for intent extraction");
  }

  if (userMessages.length === 0) {
    throw new Error("No user messages provided for intent extraction");
  }

  const model = getTextModelName();
  const baseURL = env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

  // Combine user messages into a single context
  const conversationText = userMessages
    .map((msg, i) => `[Message ${i + 1}]:\n${msg}`)
    .join("\n\n");

  debugIntent(`Extracting intent from ${userMessages.length} messages (${conversationText.length} chars)`);

  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: INTENT_EXTRACTION_PROMPT,
          },
          {
            role: "user",
            content: `Extract the user's intent from these conversation messages:\n\n${conversationText}`,
          },
        ],
        temperature: 0, // Deterministic for consistent extraction
        reasoning_effort: "low",
        response_format: { type: "json_schema", json_schema: INTENT_JSON_SCHEMA },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Intent extraction failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    if (!result.choices || result.choices.length === 0) {
      throw new Error("No response generated for intent extraction");
    }

    let content = result.choices[0].message?.content as string;
    if (!content) {
      throw new Error("No content in intent extraction response");
    }

    // Clean up any markdown formatting
    content = content.trim();
    if (content.startsWith("```json")) {
      content = content.substring("```json".length);
    }
    if (content.endsWith("```")) {
      content = content.substring(0, content.length - "```".length);
    }
    content = content.trim();

    const extracted: IntentExtractionResult = JSON.parse(content);

    debugIntent("Intent extracted successfully:", extracted.title);

    // Build the full IntentSpec
    const intentSpec: IntentSpec = {
      version: 1,
      extractedAt: new Date().toISOString(),
      extractedFromTaskId: taskId,
      goal: extracted.goal,
      inputs: extracted.inputs,
      outputs: extracted.outputs,
      assumptions: extracted.assumptions,
      nonGoals: extracted.nonGoals,
      semanticConstraints: extracted.semanticConstraints,
      title: extracted.title,
    };

    return intentSpec;
  } catch (error) {
    debugIntent("Intent extraction failed:", error);
    throw error;
  }
}

/**
 * Parse an intent spec from JSON string.
 * Returns null if the string is empty or invalid.
 */
export function parseIntentSpec(json: string): IntentSpec | null {
  if (!json || json.trim() === "") {
    return null;
  }
  try {
    return JSON.parse(json) as IntentSpec;
  } catch {
    return null;
  }
}

/**
 * Format an intent spec for display in maintainer context.
 */
export function formatIntentForPrompt(intentSpec: IntentSpec): string {
  const sections: string[] = [];

  sections.push(`Goal: ${intentSpec.goal}`);

  if (intentSpec.inputs.length > 0) {
    sections.push(`Inputs: ${intentSpec.inputs.join(", ")}`);
  }

  if (intentSpec.outputs.length > 0) {
    sections.push(`Outputs: ${intentSpec.outputs.join(", ")}`);
  }

  if (intentSpec.assumptions.length > 0) {
    sections.push(`Assumptions: ${intentSpec.assumptions.join("; ")}`);
  }

  if (intentSpec.nonGoals.length > 0) {
    sections.push(`Non-goals: ${intentSpec.nonGoals.join("; ")}`);
  }

  if (intentSpec.semanticConstraints.length > 0) {
    sections.push(`Constraints: ${intentSpec.semanticConstraints.join("; ")}`);
  }

  return sections.join("\n");
}
