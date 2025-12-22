import { StepOutput, TaskType } from "./agent-types";

export class MspParser {
  private type: TaskType;

  constructor(type: TaskType) {
    this.type = type;
  }

  parse(steps: number, text: string): StepOutput {
    const kind = getSection(text, "STEP_KIND")?.trim();
    switch (this.type) {
      case "replier":
      case "router": {
        if (kind !== "done" && kind !== "code")
          throw new Error("STEP_KIND must be 'code' or 'done'");
        break;
      }
      case "worker": {
        if (kind !== "done" && kind !== "code" && kind !== "wait")
          throw new Error("STEP_KIND must be 'code' or 'done' or 'wait'");
        break;
      }
    }

    const reasoning = getSection(text, "STEP_REASONING")?.trim();

    switch (kind) {
      case "done": {
        const reply = getSection(text, "TASK_REPLY");
        if (reply === undefined)
          throw new Error("TASK_REPLY is required for STEP_KIND='done'");
        return {
          steps,
          kind,
          reasoning,
          reply,
        };
      }
      case "code": {
        let code = getSection(text, "STEP_CODE");
        if (code) code = extractCodeBlock(code);
        if (!code)
          throw new Error("STEP_CODE is required for STEP_KIND='code'");
        return {
          steps,
          kind,
          reasoning,
          code: extractCodeBlock(code),
        };
      }
      case "wait": {
        const resumeAt = getSection(text, "TASK_RESUME_AT")?.trim();
        const asks = getSection(text, "TASK_ASKS");
        if (!resumeAt && !asks)
          throw new Error(
            "TASK_RESUME_AT or TASK_ASKS is required for STEP_KIND='wait'"
          );
        const notes = getSection(text, "TASK_NOTES");
        const plan = getSection(text, "TASK_PLAN");
        const reply = getSection(text, "TASK_REPLY");
        return {
          steps,
          kind,
          reasoning,
          reply,
          resumeAt,
          patch: {
            asks,
            notes,
            plan,
          },
        };
      }
    }
  }
}

function escapeRegExp(s: string) {
  // Escape user-provided section names for use in a RegExp
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSection(text: string, name: string): string | undefined {
  const esc = escapeRegExp(name);
  // Match:
  //  ===NAME===[spaces/tabs]*<newline?>
  //  capture lazily until next "\n===SOMETHING===" or end of string.
  const re = new RegExp(
    `===${esc}===[ \\t]*([\\s\\S]*?)(?=\\r?\\n===.+?===|$)`
  );
  const m = text.match(re);
  // preserve empty string if present; only use undefined when no match at all
  return m ? m[1].trimEnd() : undefined;
}

function extractCodeBlock(s: string): string {
  const m =
    s.match(/```(?:js|javascript)?\s*([\s\S]*?)```/i) ??
    s.match(/```([\s\S]*?)```/);
  if (m) return m[1].trim();
  // Fallback: if no fences, treat whole section as code
  return s.trim();
}
