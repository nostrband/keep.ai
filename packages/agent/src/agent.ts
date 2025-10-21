import { Experimental_Agent as Agent, stepCountIs } from "ai";
import { AGENT_MODE, getInstructions } from "./instructions";
import { getModelName, getOpenRouter } from "./model";
import { Toolset } from "./tools";
import { MemoryStore } from "@app/db";
import debug from "debug";

const debugAgent = debug("agent:core");

export async function makeAgent({
  mode,
  stepLimit,
  tools,
  memoryStore,
}: {
  mode: AGENT_MODE;
  stepLimit: number;
  memoryStore: MemoryStore;
  tools: Toolset;
}) {
  // Get working memory for system prompt
  const resource = await memoryStore.getResource();
  const workingMemoryTemplate = `
# User Profile
- **Name**:
- **Location**:
- **Preferred Tone**:
- **Schedule**:
- **Interests**:
- **Preferences**:
- **Long-term Goals**:
- **Projects**:
- **Challenges**:
`;
  const workingMemory = resource?.workingMemory || "";

  const memoryPrompt = `Working Memory:
- Below is your working memory with common facts about the user.
- Update it whenever user provides new knowledge about themselves.
- Prefer patchWorkingMemory tool for efficient updates, fall back to updateWorkingMemory if you have to overwrite it completely.
- If working memory is empty, use the template provided in <memoryTemplate> tag below.
- The current contents of the working memory are in <memory> tag below.

<memoryTemplate>
${workingMemoryTemplate}
</memoryTemplate>

<memory>
${workingMemory}
</memory>
`;

  const system = getInstructions(mode) + "\n\n" + memoryPrompt;

  return new Agent({
    model: getOpenRouter()(getModelName()),
    tools,
    system,
    stopWhen: stepCountIs(stepLimit),
    prepareStep: async ({
      model, // Current model configuration
      stepNumber, // Current step number (0-indexed)
      steps, // All previous steps with their results
      messages, // Messages to be sent to the model
    }) => {
      if (stepNumber === 0) {
        // Timestamper
        const msg = messages.at(-1)!;
        if (msg.role === "user") {
          const now = new Date();
          const timestamp = `
<current-time 
  utc="${now.toISOString()}"
  local="${now.toString()}"
/>
`;
          if (typeof msg.content === "string") {
            msg.content += `\n${timestamp}`;
          } else if (msg.content.length > 0) {
            msg.content.push({
              type: "text",
              text: timestamp,
            });
          }
        }

        return {
          messages
        }
      }

      // Change nothing
      return {};
    },
    onStepFinish(stepResult) {
      debugAgent("step result", JSON.stringify(stepResult, null, 2));
      if (stepResult.finishReason === "stop") {
        // FIXME write messages to db
        debugAgent("finished", JSON.stringify(stepResult, null, 2));
      }
    },
  });
}
