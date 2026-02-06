import { describe, it, expect } from "vitest";
import { validateWorkflowScript, isWorkflowFormatScript } from "@app/agent";

/**
 * Tests for workflow validation (exec-05) with exec-15 updates.
 *
 * Covers:
 * - Producer publishes validation (required, non-empty)
 * - Consumer publishes validation (optional)
 * - Topic graph validation (all topics must be declared)
 */

describe("Workflow Validation", () => {
  describe("Basic structure", () => {
    it("should reject script without workflow object", async () => {
      const code = `const x = 1;`;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Script must define a workflow object");
    });

    it("should reject workflow without producers or consumers", async () => {
      const code = `const workflow = { topics: { test: {} } };`;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("must have at least one producer or consumer");
    });

    it("should accept valid workflow with producer", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {} },
          producers: {
            emailPoll: {
              handler: async () => {},
              schedule: { interval: "5m" },
              publishes: ["emails"],
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(true);
      expect(result.config?.producers.emailPoll).toBeDefined();
      expect(result.config?.producers.emailPoll.publishes).toEqual(["emails"]);
    });

    it("should accept valid workflow with consumer", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {} },
          consumers: {
            processEmail: {
              subscribe: ["emails"],
              prepare: async () => ({ reservations: [], data: {} }),
              mutate: async () => {},
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(true);
      expect(result.config?.consumers.processEmail).toBeDefined();
      expect(result.config?.consumers.processEmail.subscribe).toEqual(["emails"]);
    });
  });

  describe("Producer validation (exec-15)", () => {
    it("should reject producer without publishes", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {} },
          producers: {
            emailPoll: {
              handler: async () => {},
              schedule: { interval: "5m" },
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(false);
      // Error contains handler name in template literal - check for key parts
      expect(result.error).toMatch(/Producer.*publishes.*non-empty array/i);
    });

    it("should reject producer with empty publishes array", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {} },
          producers: {
            emailPoll: {
              handler: async () => {},
              schedule: { interval: "5m" },
              publishes: [],
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Producer.*publishes.*non-empty array/i);
    });

    it("should reject producer without handler", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {} },
          producers: {
            emailPoll: {
              schedule: { interval: "5m" },
              publishes: ["emails"],
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Producer.*handler.*function/i);
    });

    it("should reject producer without schedule", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {} },
          producers: {
            emailPoll: {
              handler: async () => {},
              publishes: ["emails"],
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Producer.*schedule.*interval|cron/i);
    });

    it("should accept producer with cron schedule", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {} },
          producers: {
            emailPoll: {
              handler: async () => {},
              schedule: { cron: "0 * * * *" },
              publishes: ["emails"],
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(true);
      expect(result.config?.producers.emailPoll.schedule.cron).toBe("0 * * * *");
    });

    it("should extract multiple publishes", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {}, "audit": {} },
          producers: {
            emailPoll: {
              handler: async () => {},
              schedule: { interval: "5m" },
              publishes: ["emails", "audit"],
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(true);
      expect(result.config?.producers.emailPoll.publishes).toEqual(["emails", "audit"]);
    });
  });

  describe("Consumer validation (exec-15)", () => {
    it("should reject consumer without subscribe", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {} },
          consumers: {
            processEmail: {
              prepare: async () => ({ reservations: [], data: {} }),
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Consumer.*subscribe.*non-empty array/i);
    });

    it("should reject consumer without prepare", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {} },
          consumers: {
            processEmail: {
              subscribe: ["emails"],
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Consumer.*prepare.*function/i);
    });

    it("should accept consumer without publishes", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {} },
          consumers: {
            processEmail: {
              subscribe: ["emails"],
              prepare: async () => ({ reservations: [], data: {} }),
              mutate: async () => {},
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(true);
      expect(result.config?.consumers.processEmail.publishes).toEqual([]);
    });

    it("should accept consumer with publishes and next function", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {}, "processed": {} },
          consumers: {
            processEmail: {
              subscribe: ["emails"],
              prepare: async () => ({ reservations: [], data: {} }),
              next: async () => {},
              publishes: ["processed"],
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(true);
      expect(result.config?.consumers.processEmail.publishes).toEqual(["processed"]);
      expect(result.config?.consumers.processEmail.hasNext).toBe(true);
    });

    it("should reject consumer with publishes but no next function", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {}, "processed": {} },
          consumers: {
            processEmail: {
              subscribe: ["emails"],
              prepare: async () => ({ reservations: [], data: {} }),
              publishes: ["processed"],
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Consumer.*declares publishes.*no next/i);
    });

    it("should extract hasMutate and hasNext flags", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {} },
          consumers: {
            withBoth: {
              subscribe: ["emails"],
              prepare: async () => ({ reservations: [], data: {} }),
              mutate: async () => {},
              next: async () => {},
            },
            withMutateOnly: {
              subscribe: ["emails"],
              prepare: async () => ({ reservations: [], data: {} }),
              mutate: async () => {},
            },
            withNextOnly: {
              subscribe: ["emails"],
              prepare: async () => ({ reservations: [], data: {} }),
              next: async () => {},
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(true);
      expect(result.config?.consumers.withBoth.hasMutate).toBe(true);
      expect(result.config?.consumers.withBoth.hasNext).toBe(true);
      expect(result.config?.consumers.withMutateOnly.hasMutate).toBe(true);
      expect(result.config?.consumers.withMutateOnly.hasNext).toBe(false);
      expect(result.config?.consumers.withNextOnly.hasMutate).toBe(false);
      expect(result.config?.consumers.withNextOnly.hasNext).toBe(true);
    });
  });

  describe("Topic graph validation (exec-15)", () => {
    it("should reject producer publishing to undeclared topic", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {} },
          producers: {
            emailPoll: {
              handler: async () => {},
              schedule: { interval: "5m" },
              publishes: ["undeclared"],
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Producer.*publishes.*undeclared topic/i);
    });

    it("should reject consumer subscribing to undeclared topic", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {} },
          consumers: {
            processEmail: {
              subscribe: ["undeclared"],
              prepare: async () => ({ reservations: [], data: {} }),
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Consumer.*subscribes.*undeclared topic/i);
    });

    it("should reject consumer publishing to undeclared topic", async () => {
      const code = `
        const workflow = {
          topics: { "emails": {} },
          consumers: {
            processEmail: {
              subscribe: ["emails"],
              prepare: async () => ({ reservations: [], data: {} }),
              next: async () => {},
              publishes: ["undeclared"],
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Consumer.*publishes.*undeclared topic/i);
    });

    it("should accept valid topic graph", async () => {
      const code = `
        const workflow = {
          topics: { "raw": {}, "processed": {}, "audit": {} },
          producers: {
            poll: {
              handler: async () => {},
              schedule: { interval: "5m" },
              publishes: ["raw", "audit"],
            }
          },
          consumers: {
            process: {
              subscribe: ["raw"],
              prepare: async () => ({ reservations: [], data: {} }),
              next: async () => {},
              publishes: ["processed"],
            },
            archive: {
              subscribe: ["processed", "audit"],
              prepare: async () => ({ reservations: [], data: {} }),
              mutate: async () => {},
            }
          }
        };
      `;
      const result = await validateWorkflowScript(code);

      expect(result.valid).toBe(true);
      expect(result.config?.topics).toEqual(["raw", "processed", "audit"]);
    });
  });

  describe("isWorkflowFormatScript", () => {
    it("should detect const workflow declaration", () => {
      expect(isWorkflowFormatScript("const workflow = {}")).toBe(true);
    });

    it("should detect let workflow declaration", () => {
      expect(isWorkflowFormatScript("let workflow = {}")).toBe(true);
    });

    it("should detect var workflow declaration", () => {
      expect(isWorkflowFormatScript("var workflow = {}")).toBe(true);
    });

    it("should not detect workflow as variable name only", () => {
      expect(isWorkflowFormatScript("workflow.run()")).toBe(false);
    });

    it("should not detect non-workflow scripts", () => {
      expect(isWorkflowFormatScript("const x = 1;")).toBe(false);
    });
  });
});
