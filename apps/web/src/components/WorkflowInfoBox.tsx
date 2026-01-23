import { Workflow } from "packages/db/dist";
import { WorkflowStatusBadge } from "./StatusBadge";
import { formatCronSchedule } from "../lib/formatCronSchedule";
import { getWorkflowTitle } from "../lib/workflowUtils";

interface WorkflowInfoBoxProps {
  workflow: Workflow;
  onClick?: () => void;
}

/**
 * Workflow info box for displaying workflow context on chat pages.
 * Tappable - navigates to workflow hub when clicked.
 */
export function WorkflowInfoBox({ workflow, onClick }: WorkflowInfoBoxProps) {
  const schedule = formatCronSchedule(workflow.cron);

  return (
    <button
      onClick={onClick}
      className="w-full p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors text-left border border-gray-200 cursor-pointer"
    >
      <div className="flex items-center gap-2">
        <span>📋</span>
        <span className="font-medium text-gray-900 truncate">
          {getWorkflowTitle(workflow)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
        <WorkflowStatusBadge status={workflow.status} />
        <span>·</span>
        <span>{schedule}</span>
      </div>
    </button>
  );
}
