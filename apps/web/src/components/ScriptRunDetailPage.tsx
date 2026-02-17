import React, { useMemo, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import {
  Circle,
  CheckCircle2,
  XCircle,
  ChevronRight,
} from "lucide-react";
import { useScriptRun, useScript, useRetriesOfRun, useWorkflow } from "../hooks/dbScriptReads";
import { useWorkflowInputs, useWorkflowMutations } from "../hooks/dbInputReads";
import { useHandlerRunsBySession, useEventCountsBySession } from "../hooks/dbHandlerRunReads";
import SharedHeader from "./SharedHeader";
import { Badge } from "../ui";
import { ScriptRunStatusBadge, HandlerRunStatusBadge } from "./StatusBadge";
import {
  MutationStatusIcon,
  MutationStatusBadge,
  MutationResultPanel,
  ExpandChevron,
  getMutationTitle,
} from "./MutationRow";
import type { InputStatus, HandlerRun, Mutation } from "@app/db";

type TabId = "inputs" | "outputs" | "handlers";

function InputStatusIcon({ status }: { status: InputStatus }) {
  switch (status) {
    case "pending":
      return <Circle className="w-4 h-4 text-yellow-500 fill-yellow-500" />;
    case "done":
      return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    case "skipped":
      return <XCircle className="w-4 h-4 text-gray-400" />;
    default:
      return <Circle className="w-4 h-4 text-gray-400" />;
  }
}

function formatTimestamp(ts: string | number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString();
  }
}

function formatDuration(startTs: string, endTs: string): string {
  const ms = new Date(endTs).getTime() - new Date(startTs).getTime();
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export default function ScriptRunDetailPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: TabId =
    tabParam === "inputs" || tabParam === "outputs" || tabParam === "handlers"
      ? tabParam
      : "inputs";
  const [expandedMutationId, setExpandedMutationId] = useState<string | null>(null);

  const { data: run, isLoading } = useScriptRun(runId!);
  const { data: script } = useScript(run?.script_id || "");
  const { data: retries } = useRetriesOfRun(runId!);
  const { data: originalRun } = useScriptRun(run?.retry_of || "");
  const { data: workflow } = useWorkflow(run?.workflow_id || "");

  // Handler runs for this session
  const { data: handlerRuns = [], isLoading: isLoadingHandlers } = useHandlerRunsBySession(runId!);

  // Inputs and mutations for the workflow (we'll filter to this session)
  const { data: allInputs = [], isLoading: isLoadingInputs } = useWorkflowInputs(run?.workflow_id || "");
  const { data: allMutations = [], isLoading: isLoadingMutations } = useWorkflowMutations(run?.workflow_id || "");

  // Handler run IDs in this session for filtering
  const handlerRunIdList = useMemo(
    () => handlerRuns.map((hr) => hr.id),
    [handlerRuns]
  );
  const handlerRunIds = useMemo(
    () => new Set(handlerRunIdList),
    [handlerRunIdList]
  );

  // Event counts per handler run
  const { data: eventCounts = {} } = useEventCountsBySession(runId!, handlerRunIdList);

  // Input counts per handler run
  const inputCountsByRun = useMemo(() => {
    const map: Record<string, number> = {};
    for (const input of allInputs) {
      if (handlerRunIds.has(input.created_by_run_id)) {
        map[input.created_by_run_id] = (map[input.created_by_run_id] || 0) + 1;
      }
    }
    return map;
  }, [allInputs, handlerRunIds]);

  // Mutation by handler run
  const mutationByRun = useMemo(() => {
    const map: Record<string, typeof allMutations[0]> = {};
    for (const m of allMutations) {
      if (m.tool_namespace !== "" && handlerRunIds.has(m.handler_run_id)) {
        map[m.handler_run_id] = m;
      }
    }
    return map;
  }, [allMutations, handlerRunIds]);

  // Inputs registered during this session's handler runs
  const sessionInputs = useMemo(
    () => allInputs.filter((i) => handlerRunIds.has(i.created_by_run_id)),
    [allInputs, handlerRunIds]
  );

  // Mutations created during this session's handler runs
  const sessionMutations = useMemo(
    () => allMutations.filter((m) => m.tool_namespace !== "" && handlerRunIds.has(m.handler_run_id)),
    [allMutations, handlerRunIds]
  );

  const handleTabChange = (tab: TabId) => {
    setSearchParams({ tab });
  };

  if (!id || !runId) {
    return <div>Script run ID not found</div>;
  }

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "inputs", label: "Inputs", count: sessionInputs.length },
    { id: "outputs", label: "Outputs", count: sessionMutations.length },
    { id: "handlers", label: "Handler Runs", count: handlerRuns.length },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader
        title="Scripts"
        subtitle={run ? `Run ${run.id.slice(0, 8)}` : undefined}
      />

      <div className="max-w-4xl mx-auto px-6 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div>Loading script run...</div>
          </div>
        ) : !run ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">Script run not found</div>
          </div>
        ) : (
          <>
            {/* Header card */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    Run {run.id.slice(0, 8)}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <ScriptRunStatusBadge error={run.error} endTimestamp={run.end_timestamp} />
                    {run.retry_of && run.retry_count > 0 && (
                      <Badge variant="outline" className="text-orange-700 border-orange-300 bg-orange-50">
                        Retry #{run.retry_count}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Started</span>
                  <p className="text-gray-900">{new Date(run.start_timestamp).toLocaleString()}</p>
                </div>

                {run.end_timestamp && (
                  <div>
                    <span className="text-gray-500">Ended</span>
                    <p className="text-gray-900">{new Date(run.end_timestamp).toLocaleString()}</p>
                  </div>
                )}

                {run.end_timestamp && (
                  <div>
                    <span className="text-gray-500">Duration</span>
                    <p className="text-gray-900">{formatDuration(run.start_timestamp, run.end_timestamp)}</p>
                  </div>
                )}

                {run.cost > 0 && (
                  <div>
                    <span className="text-gray-500">Cost</span>
                    <p className="text-gray-900">${(run.cost / 1000000).toFixed(2)}</p>
                  </div>
                )}

                <div>
                  <span className="text-gray-500">Run ID</span>
                  <p className="text-gray-900 font-mono text-xs">{run.id}</p>
                </div>

                {run.retry_of && (
                  <div>
                    <span className="text-gray-500">Retry of</span>
                    <p>
                      <Link
                        to={`/scripts/${originalRun?.script_id || run.script_id}/runs/${run.retry_of}`}
                        className="text-blue-600 hover:text-blue-800 underline font-mono text-xs"
                      >
                        {run.retry_of.slice(0, 16)}...
                      </Link>
                    </p>
                  </div>
                )}
              </div>

              {/* Retry attempts */}
              {retries && retries.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <span className="text-sm text-gray-500">Retry Attempts ({retries.length})</span>
                  <div className="mt-2 space-y-1">
                    {retries.map((retry) => (
                      <div key={retry.id} className="flex items-center gap-2">
                        <Link
                          to={`/scripts/${retry.script_id}/runs/${retry.id}`}
                          className="text-blue-600 hover:text-blue-800 underline font-mono text-xs"
                        >
                          Retry #{retry.retry_count}
                        </Link>
                        <ScriptRunStatusBadge
                          error={retry.error}
                          endTimestamp={retry.end_timestamp}
                          size="small"
                          labels={{ error: "Failed", success: "Success", running: "Running" }}
                        />
                        <span className="text-xs text-gray-500">
                          {new Date(retry.start_timestamp).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Script box */}
            {script && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Script</h2>
                <Link
                  to={`/scripts/${script.id}`}
                  className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-gray-900">Script {script.id.slice(0, 8)}</span>
                        <Badge variant="outline">v{script.major_version}.{script.minor_version}</Badge>
                      </div>
                      {script.change_comment && (
                        <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                          {script.change_comment}
                        </p>
                      )}
                      <div className="text-xs text-gray-500">
                        Updated: {new Date(script.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </Link>
              </div>
            )}

            {/* Error display */}
            {run.error && (
              <div className="bg-white rounded-lg border border-red-200 p-6 mb-6">
                <h3 className="text-sm font-medium text-red-700 mb-2">Error</h3>
                <pre className="text-red-900 whitespace-pre-wrap bg-red-50 p-3 rounded border border-red-200 text-sm font-mono overflow-x-auto">
                  {run.error}
                </pre>
              </div>
            )}

            {/* Tabs */}
            <div className="bg-white rounded-lg border border-gray-200">
              {/* Tab bar */}
              <div className="flex border-b border-gray-200">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                      activeTab === tab.id
                        ? "border-blue-500 text-blue-600"
                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    {tab.label}
                    <span className="ml-1.5 text-xs text-gray-400">({tab.count})</span>
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="p-6">
                {activeTab === "handlers" && (
                  <HandlerRunsTab
                    handlerRuns={handlerRuns}
                    isLoading={isLoadingHandlers}
                    scriptId={id}
                    runId={runId}
                    inputCountsByRun={inputCountsByRun}
                    eventCounts={eventCounts}
                    mutationByRun={mutationByRun}
                  />
                )}

                {activeTab === "inputs" && (
                  <InputsTab
                    inputs={sessionInputs}
                    isLoading={isLoadingInputs || isLoadingHandlers}
                    workflowId={run.workflow_id}
                  />
                )}

                {activeTab === "outputs" && (
                  <OutputsTab
                    mutations={sessionMutations}
                    isLoading={isLoadingMutations || isLoadingHandlers}
                    expandedId={expandedMutationId}
                    onToggleExpand={(id) => setExpandedMutationId(expandedMutationId === id ? null : id)}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function HandlerRunsTab({
  handlerRuns,
  isLoading,
  scriptId,
  runId,
  inputCountsByRun,
  eventCounts,
  mutationByRun,
}: {
  handlerRuns: HandlerRun[];
  isLoading: boolean;
  scriptId: string;
  runId: string;
  inputCountsByRun: Record<string, number>;
  eventCounts: Record<string, { created: number; consumed: number }>;
  mutationByRun: Record<string, Mutation>;
}) {
  if (isLoading) {
    return <div className="text-gray-500 text-center py-8">Loading handler runs...</div>;
  }

  if (handlerRuns.length === 0) {
    return <div className="text-gray-500 text-center py-8">No handler runs recorded</div>;
  }

  return (
    <div className="space-y-2">
      {handlerRuns.map((hr) => {
        const inputCount = inputCountsByRun[hr.id] || 0;
        const counts = eventCounts[hr.id];
        const createdCount = counts?.created || 0;
        const consumedCount = counts?.consumed || 0;
        const mutation = mutationByRun[hr.id];

        return (
          <Link
            key={hr.id}
            to={`/scripts/${scriptId}/runs/${runId}/handler/${hr.id}`}
            className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
          >
            {/* Row 1: name, type, status */}
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-gray-900">{hr.handler_name}</span>
                <Badge variant="outline" className="text-xs">
                  {hr.handler_type}
                </Badge>
                <HandlerRunStatusBadge status={hr.status} />
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
            </div>

            {/* Row 2: activity summary badges */}
            <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
              {inputCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs">
                  {inputCount} input{inputCount !== 1 ? "s" : ""}
                </span>
              )}
              {createdCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs">
                  {createdCount} published
                </span>
              )}
              {consumedCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs">
                  {consumedCount} consumed
                </span>
              )}
              {mutation && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-50 text-xs">
                  <MutationStatusIcon status={mutation.status} />
                  <span className={
                    mutation.status === "applied"
                      ? "text-green-700"
                      : mutation.status === "failed"
                      ? "text-red-700"
                      : mutation.status === "indeterminate"
                      ? "text-amber-700"
                      : "text-gray-700"
                  }>
                    {getMutationTitle(mutation)}
                  </span>
                </span>
              )}
              {!inputCount && !createdCount && !consumedCount && !mutation && (
                <span className="text-xs text-gray-400 italic">no activity</span>
              )}
            </div>

            {/* Row 3: time metadata */}
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>{formatTimestamp(hr.start_timestamp)}</span>
              {hr.end_timestamp && (
                <>
                  <span>·</span>
                  <span>{formatDuration(hr.start_timestamp, hr.end_timestamp)}</span>
                </>
              )}
              {hr.cost > 0 && (
                <>
                  <span>·</span>
                  <span>${(hr.cost / 1000000).toFixed(2)}</span>
                </>
              )}
            </div>

            {/* Error line */}
            {hr.error && (
              <p className="text-sm text-red-600 mt-1 line-clamp-1">{hr.error}</p>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function InputsTab({
  inputs,
  isLoading,
  workflowId,
}: {
  inputs: { id: string; title: string; source: string; type: string; status: InputStatus; created_at: number; created_by_run_id: string }[];
  isLoading: boolean;
  workflowId: string;
}) {
  if (isLoading) {
    return <div className="text-gray-500 text-center py-8">Loading inputs...</div>;
  }

  if (inputs.length === 0) {
    return <div className="text-gray-500 text-center py-8">No inputs registered during this run</div>;
  }

  return (
    <div className="space-y-2">
      {inputs.map((input) => (
        <Link
          key={input.id}
          to={`/workflow/${workflowId}/input/${input.id}`}
          className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
        >
          <div className="flex items-start gap-3">
            <InputStatusIcon status={input.status} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-gray-900 truncate">{input.title}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>{input.source} / {input.type}</span>
                <span>·</span>
                <span>{formatTimestamp(input.created_at)}</span>
              </div>
            </div>
            <Badge
              variant="outline"
              className={
                input.status === "done"
                  ? "text-green-700 border-green-300"
                  : input.status === "pending"
                  ? "text-yellow-700 border-yellow-300"
                  : "text-gray-500 border-gray-300"
              }
            >
              {input.status}
            </Badge>
          </div>
        </Link>
      ))}
    </div>
  );
}

function OutputsTab({
  mutations,
  isLoading,
  expandedId,
  onToggleExpand,
}: {
  mutations: { id: string; status: string; ui_title: string; tool_namespace: string; tool_method: string; result: string; error: string; created_at: number; handler_run_id: string }[];
  isLoading: boolean;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
}) {
  if (isLoading) {
    return <div className="text-gray-500 text-center py-8">Loading outputs...</div>;
  }

  if (mutations.length === 0) {
    return <div className="text-gray-500 text-center py-8">No outputs produced during this run</div>;
  }

  return (
    <div className="space-y-2">
      {mutations.map((mutation) => {
        const isExpanded = expandedId === mutation.id;
        return (
          <div
            key={mutation.id}
            className={`border rounded-lg transition-all cursor-pointer ${
              mutation.status === "indeterminate"
                ? "border-amber-300 bg-amber-50"
                : mutation.status === "failed"
                ? "border-red-200 bg-red-50"
                : "border-gray-200 hover:border-gray-300"
            }`}
            onClick={() => onToggleExpand(mutation.id)}
          >
            <div className="flex items-start justify-between p-4">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <MutationStatusIcon status={mutation.status as any} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900 truncate">
                      {getMutationTitle(mutation as any)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>{mutation.tool_namespace}</span>
                    <span>·</span>
                    <span>{mutation.tool_method}</span>
                    <span>·</span>
                    <span>{formatTimestamp(mutation.created_at)}</span>
                  </div>
                  {mutation.status === "failed" && mutation.error && (
                    <p className="text-sm text-red-600 mt-1 line-clamp-2">{mutation.error}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <MutationStatusBadge status={mutation.status as any} />
                <ExpandChevron expanded={isExpanded} />
              </div>
            </div>
            {isExpanded && <MutationResultPanel mutation={mutation as any} />}
          </div>
        );
      })}
    </div>
  );
}
