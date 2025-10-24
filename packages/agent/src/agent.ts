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
      const msg = messages.at(-1)!;
      const res: any = {};
      if (stepNumber === 0) {
        // Timestamper
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

        // Override messages
        res.messages = messages;
      }

      const text =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .map((p) => {
                const pr = p.type + ":";
                switch (p.type) {
                  case "text":
                    return pr + p.text;
                  case "tool-call":
                    return pr + p.toolName;
                  case "tool-result":
                    return pr + p.toolName;
                  case "file":
                    return pr + p.filename || "<file>";
                  case "image":
                    return (
                      pr +
                      (p.image instanceof URL ? p.image.toString() : "<image>")
                    );
                  case "reasoning":
                    return pr + p.text;
                }
              })
              .join(", ");
      debugAgent(`Step ${stepNumber}: '${text}'`);

      // Change nothing
      return res;
    },
    onStepFinish(stepResult) {
      debugAgent(
        `Step result (${stepResult.finishReason}): '${
          stepResult.text ||
          stepResult.toolResults.map((r) => JSON.stringify(r.output)).join("\n")
        }' usage ${JSON.stringify(stepResult.usage)}`
      );
      // if (stepResult.finishReason === "stop") {
      //   // FIXME write messages to db
      //   debugAgent("finished", JSON.stringify(stepResult, null, 2));
      // }
    },
  });
}
