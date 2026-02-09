import React from "react";
import type { IntentSpec } from "@app/db";

interface WorkflowIntentSectionProps {
  intentSpecJson: string;
}

/**
 * Parse intent spec JSON safely.
 */
function parseIntentSpec(json: string): IntentSpec | null {
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
 * Display structured intent from the Intent Spec (exec-17).
 * Shows goal, inputs, outputs, assumptions, non-goals, and semantic constraints.
 */
export function WorkflowIntentSection({ intentSpecJson }: WorkflowIntentSectionProps) {
  const intentSpec = parseIntentSpec(intentSpecJson);

  if (!intentSpec) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Intent</h2>

      {/* Goal */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-700 mb-1">Goal</h3>
        <p className="text-gray-900">{intentSpec.goal}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Inputs */}
        {intentSpec.inputs?.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">Watches</h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1">
              {intentSpec.inputs?.map((input, i) => (
                <li key={i} className="text-sm">{input}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Outputs */}
        {intentSpec.outputs?.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">Produces</h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1">
              {intentSpec.outputs?.map((output, i) => (
                <li key={i} className="text-sm">{output}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Assumptions */}
      {intentSpec.assumptions?.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Assumptions</h3>
          <ul className="list-disc list-inside text-gray-600 space-y-1">
            {intentSpec.assumptions?.map((assumption, i) => (
              <li key={i} className="text-sm">{assumption}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Non-goals */}
      {intentSpec.nonGoals?.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">What it won't do</h3>
          <ul className="list-disc list-inside text-gray-600 space-y-1">
            {intentSpec.nonGoals?.map((nonGoal, i) => (
              <li key={i} className="text-sm">{nonGoal}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Semantic constraints */}
      {intentSpec.semanticConstraints?.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">
            Constraints
            <span className="ml-2 text-xs font-normal text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">best-effort</span>
          </h3>
          <ul className="list-disc list-inside text-gray-600 space-y-1">
            {intentSpec.semanticConstraints?.map((constraint, i) => (
              <li key={i} className="text-sm">{constraint}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Extracted metadata */}
      <div className="mt-4 pt-4 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          Intent extracted {new Date(intentSpec.extractedAt).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}
