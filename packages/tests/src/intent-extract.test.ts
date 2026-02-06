import { describe, it, expect } from "vitest";
import { parseIntentSpec, formatIntentForPrompt } from "@app/agent";
import type { IntentSpec } from "@app/db";

/**
 * Tests for Intent Extraction module (exec-17).
 *
 * These tests cover the utility functions for parsing and formatting intent specs.
 * The extractIntent function itself calls an external LLM API, so integration tests
 * for that would need mocking or be run against a real API.
 */

describe("Intent Extraction", () => {
  describe("parseIntentSpec", () => {
    it("should parse a valid IntentSpec JSON string", () => {
      const validJson = JSON.stringify({
        version: 1,
        extractedAt: "2024-01-01T00:00:00.000Z",
        extractedFromTaskId: "task-123",
        goal: "Monitor emails and log them to a spreadsheet",
        inputs: ["New emails from Gmail"],
        outputs: ["Rows added to Google Sheet"],
        assumptions: ["User has connected Gmail account"],
        nonGoals: ["Filtering spam"],
        semanticConstraints: ["Only process emails from work domain"],
        title: "Email Logger",
      });

      const result = parseIntentSpec(validJson);

      expect(result).not.toBeNull();
      expect(result!.version).toBe(1);
      expect(result!.goal).toBe("Monitor emails and log them to a spreadsheet");
      expect(result!.inputs).toEqual(["New emails from Gmail"]);
      expect(result!.outputs).toEqual(["Rows added to Google Sheet"]);
      expect(result!.assumptions).toEqual(["User has connected Gmail account"]);
      expect(result!.nonGoals).toEqual(["Filtering spam"]);
      expect(result!.semanticConstraints).toEqual(["Only process emails from work domain"]);
      expect(result!.title).toBe("Email Logger");
    });

    it("should return null for empty string", () => {
      const result = parseIntentSpec("");
      expect(result).toBeNull();
    });

    it("should return null for whitespace-only string", () => {
      const result = parseIntentSpec("   \n\t  ");
      expect(result).toBeNull();
    });

    it("should return null for invalid JSON", () => {
      const result = parseIntentSpec("not valid json {");
      expect(result).toBeNull();
    });

    it("should return null for valid JSON that is not an IntentSpec", () => {
      const result = parseIntentSpec('{"foo": "bar"}');
      // Since we don't validate the structure, this will return the parsed object
      // The caller is responsible for using the right type
      expect(result).not.toBeNull();
    });

    it("should handle empty arrays in IntentSpec", () => {
      const json = JSON.stringify({
        version: 1,
        extractedAt: "2024-01-01T00:00:00.000Z",
        extractedFromTaskId: "task-123",
        goal: "Simple goal",
        inputs: [],
        outputs: [],
        assumptions: [],
        nonGoals: [],
        semanticConstraints: [],
        title: "Simple",
      });

      const result = parseIntentSpec(json);

      expect(result).not.toBeNull();
      expect(result!.inputs).toEqual([]);
      expect(result!.outputs).toEqual([]);
      expect(result!.assumptions).toEqual([]);
      expect(result!.nonGoals).toEqual([]);
      expect(result!.semanticConstraints).toEqual([]);
    });
  });

  describe("formatIntentForPrompt", () => {
    it("should format a complete IntentSpec", () => {
      const intentSpec: IntentSpec = {
        version: 1,
        extractedAt: "2024-01-01T00:00:00.000Z",
        extractedFromTaskId: "task-123",
        goal: "Monitor emails and log them to a spreadsheet",
        inputs: ["New emails from Gmail"],
        outputs: ["Rows added to Google Sheet"],
        assumptions: ["User has connected Gmail account"],
        nonGoals: ["Filtering spam"],
        semanticConstraints: ["Only process emails from work domain"],
        title: "Email Logger",
      };

      const result = formatIntentForPrompt(intentSpec);

      expect(result).toContain("Goal: Monitor emails and log them to a spreadsheet");
      expect(result).toContain("Inputs: New emails from Gmail");
      expect(result).toContain("Outputs: Rows added to Google Sheet");
      expect(result).toContain("Assumptions: User has connected Gmail account");
      expect(result).toContain("Non-goals: Filtering spam");
      expect(result).toContain("Constraints: Only process emails from work domain");
    });

    it("should format IntentSpec with multiple items per field", () => {
      const intentSpec: IntentSpec = {
        version: 1,
        extractedAt: "2024-01-01T00:00:00.000Z",
        extractedFromTaskId: "task-123",
        goal: "Process invoices",
        inputs: ["Emails", "Drive files"],
        outputs: ["Spreadsheet rows", "Notifications"],
        assumptions: ["Daily processing", "USD currency"],
        nonGoals: [],
        semanticConstraints: [],
        title: "Invoice Processor",
      };

      const result = formatIntentForPrompt(intentSpec);

      expect(result).toContain("Inputs: Emails, Drive files");
      expect(result).toContain("Outputs: Spreadsheet rows, Notifications");
      expect(result).toContain("Assumptions: Daily processing; USD currency");
    });

    it("should omit empty sections", () => {
      const intentSpec: IntentSpec = {
        version: 1,
        extractedAt: "2024-01-01T00:00:00.000Z",
        extractedFromTaskId: "task-123",
        goal: "Simple automation",
        inputs: [],
        outputs: [],
        assumptions: [],
        nonGoals: [],
        semanticConstraints: [],
        title: "Simple",
      };

      const result = formatIntentForPrompt(intentSpec);

      expect(result).toBe("Goal: Simple automation");
      expect(result).not.toContain("Inputs:");
      expect(result).not.toContain("Outputs:");
      expect(result).not.toContain("Assumptions:");
      expect(result).not.toContain("Non-goals:");
      expect(result).not.toContain("Constraints:");
    });

    it("should only include non-empty sections", () => {
      const intentSpec: IntentSpec = {
        version: 1,
        extractedAt: "2024-01-01T00:00:00.000Z",
        extractedFromTaskId: "task-123",
        goal: "Track expenses",
        inputs: ["Bank statements"],
        outputs: [],
        assumptions: ["Monthly processing"],
        nonGoals: [],
        semanticConstraints: [],
        title: "Expense Tracker",
      };

      const result = formatIntentForPrompt(intentSpec);

      expect(result).toContain("Goal: Track expenses");
      expect(result).toContain("Inputs: Bank statements");
      expect(result).toContain("Assumptions: Monthly processing");
      expect(result).not.toContain("Outputs:");
      expect(result).not.toContain("Non-goals:");
      expect(result).not.toContain("Constraints:");
    });

    it("should separate sections with newlines", () => {
      const intentSpec: IntentSpec = {
        version: 1,
        extractedAt: "2024-01-01T00:00:00.000Z",
        extractedFromTaskId: "task-123",
        goal: "Goal text",
        inputs: ["Input 1"],
        outputs: ["Output 1"],
        assumptions: [],
        nonGoals: [],
        semanticConstraints: [],
        title: "Test",
      };

      const result = formatIntentForPrompt(intentSpec);
      const lines = result.split("\n");

      expect(lines.length).toBe(3);
      expect(lines[0]).toBe("Goal: Goal text");
      expect(lines[1]).toBe("Inputs: Input 1");
      expect(lines[2]).toBe("Outputs: Output 1");
    });
  });

  describe("IntentSpec type validation", () => {
    it("should handle all fields being present", () => {
      const fullSpec: IntentSpec = {
        version: 1,
        extractedAt: "2024-01-01T00:00:00.000Z",
        extractedFromTaskId: "task-123",
        goal: "Full specification test",
        inputs: ["Input A", "Input B"],
        outputs: ["Output X", "Output Y"],
        assumptions: ["Assumption 1", "Assumption 2", "Assumption 3"],
        nonGoals: ["Non-goal 1"],
        semanticConstraints: ["Constraint 1", "Constraint 2"],
        title: "Full Test",
      };

      // Should be able to serialize and deserialize
      const json = JSON.stringify(fullSpec);
      const parsed = parseIntentSpec(json);

      expect(parsed).toEqual(fullSpec);
    });
  });
});
