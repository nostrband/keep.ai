import { Workflow, Script } from "packages/db/dist";
import { WorkflowStatusBadge } from "./StatusBadge";
import { formatCronSchedule } from "../lib/formatCronSchedule";
import { getWorkflowTitle } from "../lib/workflowUtils";

interface WorkflowInfoBoxProps {
  workflow: Workflow;
  onClick?: () => void;
  /** Newest unactivated script version, if any */
  newerVersion?: Script | null;
  /** Called when user clicks "Activate vX.Y" */
  onActivate?: () => void;
  activating?: boolean;
}

/**
 * Workflow info box for displaying workflow context on chat pages.
 * Tappable - navigates to workflow hub when clicked.
 */
export function WorkflowInfoBox({ workflow, onClick, newerVersion, onActivate, activating }: WorkflowInfoBoxProps) {
  const schedule = formatCronSchedule(workflow.cron);

  return (
    <div className="w-full p-3 bg-gray-50 rounded-lg border border-gray-200">
      <button
        onClick={onClick}
        className="w-full hover:bg-gray-100 rounded transition-colors text-left cursor-pointer"
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
      {newerVersion && onActivate && (
        <div className="mt-2 pt-2 border-t border-gray-200">
          <button
            onClick={(e) => { e.stopPropagation(); onActivate(); }}
            disabled={activating}
            className="px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-md disabled:opacity-50 cursor-pointer"
          >
            {activating ? "Activating..." : `Activate v${newerVersion.major_version}.${newerVersion.minor_version}`}
          </button>
        </div>
      )}
    </div>
  );
}
