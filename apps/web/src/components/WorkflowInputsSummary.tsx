import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Circle, XCircle, ChevronRight } from "lucide-react";
import {
  useWorkflowInputStats,
  useWorkflowOutputStats,
  useWorkflowNeedsAttentionCount,
} from "../hooks/dbInputReads";

interface WorkflowInputsSummaryProps {
  workflowId: string;
}

/**
 * Get a display-friendly name for a source/type combination.
 */
function formatSourceType(source: string, type: string): string {
  // Common source mappings
  const sourceMap: Record<string, string> = {
    gmail: "Gmail",
    slack: "Slack",
    sheets: "Google Sheets",
    calendar: "Google Calendar",
    drive: "Google Drive",
    github: "GitHub",
    notion: "Notion",
    trello: "Trello",
    asana: "Asana",
    jira: "Jira",
    webhook: "Webhook",
    http: "HTTP",
    rss: "RSS Feed",
    email: "Email",
  };

  // Type display names
  const typeMap: Record<string, string> = {
    email: "Emails",
    message: "Messages",
    row: "Rows",
    event: "Events",
    file: "Files",
    issue: "Issues",
    pr: "Pull Requests",
    task: "Tasks",
    page: "Pages",
    item: "Items",
    notification: "Notifications",
    webhook: "Webhooks",
    request: "Requests",
  };

  const displaySource = sourceMap[source.toLowerCase()] || source;
  const displayType = typeMap[type.toLowerCase()] || type;

  return `${displaySource} ${displayType}`;
}

/**
 * Get a display-friendly name for a connector namespace.
 */
function formatConnector(namespace: string): string {
  const connectorMap: Record<string, string> = {
    gmail: "Gmail",
    "google.gmail": "Gmail",
    slack: "Slack",
    sheets: "Google Sheets",
    "google.sheets": "Google Sheets",
    calendar: "Google Calendar",
    "google.calendar": "Google Calendar",
    drive: "Google Drive",
    "google.drive": "Google Drive",
    github: "GitHub",
    notion: "Notion",
    trello: "Trello",
    asana: "Asana",
    jira: "Jira",
    http: "HTTP",
    webhook: "Webhook",
  };

  return connectorMap[namespace.toLowerCase()] || namespace;
}

/**
 * Inputs & Outputs summary for the workflow detail page (exec-16).
 *
 * Shows:
 * - Inputs grouped by source/type with pending/done counts
 * - Outputs grouped by connector with counts
 * - Attention indicator for blocked/stale inputs
 */
export function WorkflowInputsSummary({ workflowId }: WorkflowInputsSummaryProps) {
  const { data: inputStats = [], isLoading: isLoadingInputs } = useWorkflowInputStats(workflowId);
  const { data: outputStats = [], isLoading: isLoadingOutputs } = useWorkflowOutputStats(workflowId);
  const { data: needsAttentionCount = 0 } = useWorkflowNeedsAttentionCount(workflowId);

  // Don't show if there are no inputs or outputs
  const hasInputs = inputStats.length > 0;
  const hasOutputs = outputStats.length > 0;

  if (!hasInputs && !hasOutputs && !isLoadingInputs && !isLoadingOutputs) {
    return null;
  }

  // Calculate totals
  const totalPending = inputStats.reduce((sum, s) => sum + s.pending_count, 0);
  const totalDone = inputStats.reduce((sum, s) => sum + s.done_count, 0);
  const totalSkipped = inputStats.reduce((sum, s) => sum + s.skipped_count, 0);

  const totalApplied = outputStats.reduce((sum, s) => sum + s.applied_count, 0);
  const totalFailed = outputStats.reduce((sum, s) => sum + s.failed_count, 0);
  const totalIndeterminate = outputStats.reduce((sum, s) => sum + s.indeterminate_count, 0);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Inputs & Outputs</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Inputs Section */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
            Inputs
            {totalPending > 0 && (
              <span className="text-xs text-gray-500">({totalPending} pending)</span>
            )}
          </h3>

          {isLoadingInputs ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : inputStats.length === 0 ? (
            <div className="text-sm text-gray-500">No inputs recorded yet</div>
          ) : (
            <div className="space-y-2">
              {inputStats.map((stat) => (
                <Link
                  key={`${stat.source}-${stat.type}`}
                  to={`/workflow/${workflowId}/inputs?source=${encodeURIComponent(stat.source)}&type=${encodeURIComponent(stat.type)}`}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors group"
                >
                  <span className="text-sm text-gray-900 flex items-center gap-2">
                    <span className="text-gray-400">└─</span>
                    {formatSourceType(stat.source, stat.type)}
                  </span>
                  <span className="text-xs text-gray-500 flex items-center gap-3">
                    {stat.pending_count > 0 && (
                      <span className="flex items-center gap-1 text-yellow-600">
                        <Circle className="w-3 h-3 fill-current" />
                        {stat.pending_count}
                      </span>
                    )}
                    {stat.done_count > 0 && (
                      <span className="flex items-center gap-1 text-green-600">
                        <CheckCircle2 className="w-3 h-3" />
                        {stat.done_count}
                      </span>
                    )}
                    {stat.skipped_count > 0 && (
                      <span className="flex items-center gap-1 text-gray-400">
                        <XCircle className="w-3 h-3" />
                        {stat.skipped_count}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Outputs Section */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
            Outputs
            {totalApplied > 0 && (
              <span className="text-xs text-gray-500">({totalApplied} completed)</span>
            )}
          </h3>

          {isLoadingOutputs ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : outputStats.length === 0 ? (
            <div className="text-sm text-gray-500">No outputs recorded yet</div>
          ) : (
            <div className="space-y-2">
              {outputStats.map((stat) => (
                <Link
                  key={stat.tool_namespace}
                  to={`/workflow/${workflowId}/outputs?connector=${encodeURIComponent(stat.tool_namespace)}`}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors group"
                >
                  <span className="text-sm text-gray-900 flex items-center gap-2">
                    <span className="text-gray-400">└─</span>
                    {formatConnector(stat.tool_namespace)}
                  </span>
                  <span className="text-xs text-gray-500 flex items-center gap-3">
                    {stat.applied_count > 0 && (
                      <span className="flex items-center gap-1 text-green-600">
                        <CheckCircle2 className="w-3 h-3" />
                        {stat.applied_count}
                      </span>
                    )}
                    {stat.failed_count > 0 && (
                      <span className="flex items-center gap-1 text-red-600">
                        <XCircle className="w-3 h-3" />
                        {stat.failed_count}
                      </span>
                    )}
                    {stat.indeterminate_count > 0 && (
                      <span className="flex items-center gap-1 text-amber-600">
                        <AlertTriangle className="w-3 h-3" />
                        {stat.indeterminate_count}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Attention Required Banner */}
      {needsAttentionCount > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <Link
            to={`/workflow/${workflowId}/inputs?attention=true`}
            className="flex items-center gap-2 text-amber-700 hover:text-amber-800"
          >
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">
              {needsAttentionCount} input{needsAttentionCount === 1 ? " needs" : "s need"} your attention
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}

export default WorkflowInputsSummary;
