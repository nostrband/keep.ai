import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Circle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  useHandlerRun,
  useHandlerRunRetryChain,
  useMutationByHandlerRunId,
  useEventsByHandlerRun,
  useWorkflowTopicMap,
} from "../hooks/dbHandlerRunReads";
import { useWorkflowInputs } from "../hooks/dbInputReads";
import SharedHeader from "./SharedHeader";
import { Badge } from "../ui";
import { HandlerRunStatusBadge } from "./StatusBadge";
import {
  MutationStatusIcon,
  MutationStatusBadge,
  MutationResultPanel,
  getMutationTitle,
} from "./MutationRow";
import type { HandlerRun, InputStatus, Event as WfEvent } from "@app/db";

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

function PrettyJson({ data }: { data: string }) {
  if (!data) return <span className="text-gray-400 italic">None</span>;
  try {
    const parsed = JSON.parse(data);
    return (
      <pre className="p-3 bg-gray-50 rounded-md text-xs text-gray-800 overflow-x-auto whitespace-pre-wrap break-words">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    );
  } catch {
    return (
      <pre className="p-3 bg-gray-50 rounded-md text-xs text-gray-800 overflow-x-auto whitespace-pre-wrap break-words">
        {data}
      </pre>
    );
  }
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-lg border border-gray-200 mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left cursor-pointer"
      >
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {open ? (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function EventRow({ event, topicMap }: { event: WfEvent; topicMap: Record<string, string> }) {
  const [expanded, setExpanded] = useState(false);
  const topicName = topicMap[event.topic_id] || event.topic_id;
  return (
    <div className="border border-gray-200 rounded-md">
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded(!expanded)}
      >
        <Badge
          variant="outline"
          className={
            event.status === "consumed"
              ? "text-green-700 border-green-300"
              : event.status === "pending"
              ? "text-yellow-700 border-yellow-300"
              : event.status === "reserved"
              ? "text-blue-700 border-blue-300"
              : "text-gray-500 border-gray-300"
          }
        >
          {event.status}
        </Badge>
        <span className="text-xs font-medium text-gray-600">{topicName}</span>
        <span className="font-mono text-xs text-gray-700 truncate flex-1">
          {event.message_id}
        </span>
        <span className="text-xs text-gray-500">
          {formatTimestamp(event.created_at)}
        </span>
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-gray-400" />
        ) : (
          <ChevronRight className="w-3 h-3 text-gray-400" />
        )}
      </div>
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-100">
          <div className="mt-2 text-xs text-gray-500 space-y-1">
            <div>Topic: <span className="font-mono">{topicName}</span> (<span className="font-mono">{event.topic_id}</span>)</div>
            {event.caused_by.length > 0 && (
              <div>Caused by inputs: {event.caused_by.join(", ")}</div>
            )}
          </div>
          <div className="mt-2">
            <PrettyJson data={JSON.stringify(event.payload)} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function HandlerRunDetailPage() {
  const { id: scriptId, runId, handlerRunId } = useParams<{
    id: string;
    runId: string;
    handlerRunId: string;
  }>();

  const { data: handlerRun, isLoading } = useHandlerRun(handlerRunId!);
  const { data: retryChain = [] } = useHandlerRunRetryChain(handlerRunId!);
  const { data: mutation } = useMutationByHandlerRunId(handlerRunId!);
  const { data: events } = useEventsByHandlerRun(handlerRunId!);
  const { data: topicMap = {} } = useWorkflowTopicMap(handlerRun?.workflow_id || "");

  // Inputs registered by this handler run (for producers)
  const { data: allInputs = [] } = useWorkflowInputs(handlerRun?.workflow_id || "");
  const registeredInputs = allInputs.filter(
    (i) => i.created_by_run_id === handlerRunId
  );

  if (!scriptId || !runId || !handlerRunId) {
    return <div>Handler run ID not found</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader
        title="Scripts"
        subtitle={handlerRun ? `Handler: ${handlerRun.handler_name}` : "Handler Run"}
      />

      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Back link */}
        <Link
          to={`/scripts/${scriptId}/runs/${runId}?tab=handlers`}
          className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to script run
        </Link>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div>Loading handler run...</div>
          </div>
        ) : !handlerRun ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">Handler run not found</div>
          </div>
        ) : (
          <>
            {/* Header card */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    {handlerRun.handler_name}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{handlerRun.handler_type}</Badge>
                    <HandlerRunStatusBadge status={handlerRun.status} />
                    <Badge variant="outline" className="text-gray-600">
                      Phase: {handlerRun.phase}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Started</span>
                  <p className="text-gray-900">{new Date(handlerRun.start_timestamp).toLocaleString()}</p>
                </div>

                {handlerRun.end_timestamp && (
                  <div>
                    <span className="text-gray-500">Ended</span>
                    <p className="text-gray-900">{new Date(handlerRun.end_timestamp).toLocaleString()}</p>
                  </div>
                )}

                {handlerRun.end_timestamp && (
                  <div>
                    <span className="text-gray-500">Duration</span>
                    <p className="text-gray-900">
                      {formatDuration(handlerRun.start_timestamp, handlerRun.end_timestamp)}
                    </p>
                  </div>
                )}

                {handlerRun.cost > 0 && (
                  <div>
                    <span className="text-gray-500">Cost</span>
                    <p className="text-gray-900">${(handlerRun.cost / 1000000).toFixed(2)}</p>
                  </div>
                )}

                <div>
                  <span className="text-gray-500">Handler Run ID</span>
                  <p className="text-gray-900 font-mono text-xs">{handlerRun.id}</p>
                </div>

                <div>
                  <span className="text-gray-500">Session</span>
                  <p>
                    <Link
                      to={`/scripts/${scriptId}/runs/${runId}`}
                      className="text-blue-600 hover:text-blue-800 underline font-mono text-xs"
                    >
                      {handlerRun.script_run_id.slice(0, 16)}...
                    </Link>
                  </p>
                </div>

                {handlerRun.retry_of && (
                  <div>
                    <span className="text-gray-500">Retry of</span>
                    <p>
                      <Link
                        to={`/scripts/${scriptId}/runs/${runId}/handler/${handlerRun.retry_of}`}
                        className="text-blue-600 hover:text-blue-800 underline font-mono text-xs"
                      >
                        {handlerRun.retry_of.slice(0, 16)}...
                      </Link>
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Error section */}
            {handlerRun.error && (
              <div className="bg-white rounded-lg border border-red-200 p-6 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-red-700">Error</h3>
                  {handlerRun.error_type && (
                    <Badge variant="outline" className="text-red-600 border-red-300 text-xs">
                      {handlerRun.error_type}
                    </Badge>
                  )}
                </div>
                <pre className="text-red-900 whitespace-pre-wrap bg-red-50 p-3 rounded border border-red-200 text-sm font-mono overflow-x-auto">
                  {handlerRun.error}
                </pre>
              </div>
            )}

            {/* Prepare Result (consumer only) */}
            {handlerRun.handler_type === "consumer" && handlerRun.prepare_result && (
              <PrepareResultSection prepareResult={handlerRun.prepare_result} />
            )}

            {/* Mutation section (consumer only) */}
            {handlerRun.handler_type === "consumer" && (
              <MutationSection mutation={mutation} />
            )}

            {/* Inputs section (producer only) */}
            {handlerRun.handler_type === "producer" && registeredInputs.length > 0 && (
              <CollapsibleSection title={`Registered Inputs (${registeredInputs.length})`} defaultOpen={true}>
                <div className="space-y-2">
                  {registeredInputs.map((input) => (
                    <Link
                      key={input.id}
                      to={`/workflow/${handlerRun.workflow_id}/input/${input.id}`}
                      className="block p-3 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <InputStatusIcon status={input.status} />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-gray-900 text-sm truncate block">
                            {input.title}
                          </span>
                          <span className="text-xs text-gray-500">
                            {input.source} / {input.type} · {formatTimestamp(input.created_at)}
                          </span>
                        </div>
                        <Badge
                          variant="outline"
                          className={
                            input.status === "done"
                              ? "text-green-700 border-green-300 text-xs"
                              : input.status === "pending"
                              ? "text-yellow-700 border-yellow-300 text-xs"
                              : "text-gray-500 border-gray-300 text-xs"
                          }
                        >
                          {input.status}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Events section */}
            {events && (events.created.length > 0 || events.reserved.length > 0) && (
              <CollapsibleSection
                title={`Internal Events (${events.created.length + events.reserved.length})`}
                defaultOpen={false}
              >
                {events.created.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                      Published ({events.created.length})
                    </h4>
                    <div className="space-y-1">
                      {events.created.map((e) => (
                        <EventRow key={e.id} event={e} topicMap={topicMap} />
                      ))}
                    </div>
                  </div>
                )}
                {events.reserved.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                      Reserved ({events.reserved.length})
                    </h4>
                    <div className="space-y-1">
                      {events.reserved.map((e) => (
                        <EventRow key={e.id} event={e} topicMap={topicMap} />
                      ))}
                    </div>
                  </div>
                )}
              </CollapsibleSection>
            )}

            {/* Logs section */}
            {handlerRun.logs && handlerRun.logs !== "[]" && (
              <CollapsibleSection title="Logs" defaultOpen={true}>
                <LogsDisplay logs={handlerRun.logs} />
              </CollapsibleSection>
            )}

            {/* Retry chain */}
            {retryChain.length > 1 && (
              <CollapsibleSection title={`Retry Chain (${retryChain.length} attempts)`} defaultOpen={false}>
                <div className="space-y-2">
                  {retryChain.map((attempt, index) => {
                    const isCurrent = attempt.id === handlerRunId;
                    return (
                      <div
                        key={attempt.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border ${
                          isCurrent
                            ? "border-blue-300 bg-blue-50"
                            : "border-gray-200"
                        }`}
                      >
                        <span className="text-xs text-gray-500 w-6">#{index + 1}</span>
                        <HandlerRunStatusBadge status={attempt.status} />
                        <span className="text-xs text-gray-600">
                          {new Date(attempt.start_timestamp).toLocaleString()}
                        </span>
                        {attempt.end_timestamp && (
                          <span className="text-xs text-gray-500">
                            ({formatDuration(attempt.start_timestamp, attempt.end_timestamp)})
                          </span>
                        )}
                        {isCurrent ? (
                          <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">
                            current
                          </Badge>
                        ) : (
                          <Link
                            to={`/scripts/${scriptId}/runs/${runId}/handler/${attempt.id}`}
                            className="text-xs text-blue-600 hover:text-blue-800 underline"
                          >
                            View
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CollapsibleSection>
            )}

            {/* State section (debug) */}
            {(handlerRun.input_state || handlerRun.output_state) && (
              <CollapsibleSection title="Handler State" defaultOpen={false}>
                {handlerRun.input_state && (
                  <div className="mb-4">
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                      Input State
                    </h4>
                    <PrettyJson data={handlerRun.input_state} />
                  </div>
                )}
                {handlerRun.output_state && (
                  <div>
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                      Output State
                    </h4>
                    <PrettyJson data={handlerRun.output_state} />
                  </div>
                )}
              </CollapsibleSection>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PrepareResultSection({ prepareResult }: { prepareResult: string }) {
  let parsed: any = null;
  try {
    parsed = JSON.parse(prepareResult);
  } catch {
    // Show raw if not parseable
  }

  if (!parsed) {
    return (
      <CollapsibleSection title="Prepare Result" defaultOpen={true}>
        <PrettyJson data={prepareResult} />
      </CollapsibleSection>
    );
  }

  const uiTitle = parsed.ui?.title;
  const reservations: { topic: string; ids: string[] }[] = parsed.reservations || [];
  const totalReserved = reservations.reduce((sum, r) => sum + r.ids.length, 0);

  return (
    <CollapsibleSection title="Prepare Result" defaultOpen={true}>
      {uiTitle && (
        <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <span className="text-xs font-medium text-blue-600 uppercase tracking-wide">Mutation Title</span>
          <p className="text-sm text-blue-900 mt-1">{uiTitle}</p>
        </div>
      )}
      {totalReserved > 0 && (
        <div className="mb-3">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Reservations
          </span>
          <div className="mt-1 space-y-1">
            {reservations.map((r, i) => (
              <div key={i} className="text-sm text-gray-700">
                Reserved {r.ids.length} event{r.ids.length === 1 ? "" : "s"} from topic{" "}
                <span className="font-mono text-xs">{r.topic}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {parsed.data && (
        <div>
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Data</span>
          <div className="mt-1">
            <PrettyJson data={JSON.stringify(parsed.data)} />
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}

function MutationSection({ mutation }: { mutation: any }) {
  if (!mutation) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Mutation</h3>
        <p className="text-sm text-gray-500">No mutation performed</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-semibold text-gray-900">Mutation</h3>
        <MutationStatusBadge status={mutation.status} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <MutationStatusIcon status={mutation.status} />
          <span className="font-medium text-gray-900">{getMutationTitle(mutation)}</span>
        </div>

        <div className="text-sm text-gray-600">
          <span className="text-gray-500">Tool:</span>{" "}
          {mutation.tool_namespace}.{mutation.tool_method}
        </div>

        {mutation.params && (
          <div>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Parameters</span>
            <div className="mt-1">
              <PrettyJson data={mutation.params} />
            </div>
          </div>
        )}

        {mutation.result && (
          <div>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Result</span>
            <div className="mt-1">
              <PrettyJson data={mutation.result} />
            </div>
          </div>
        )}

        {mutation.error && (
          <div>
            <span className="text-xs font-medium text-red-600 uppercase tracking-wide">Error</span>
            <pre className="mt-1 text-red-900 whitespace-pre-wrap bg-red-50 p-3 rounded border border-red-200 text-xs font-mono overflow-x-auto">
              {mutation.error}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function LogsDisplay({ logs }: { logs: string }) {
  let parsed: any[] | null = null;
  try {
    parsed = JSON.parse(logs);
  } catch {
    // Show raw
  }

  if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
    return (
      <pre className="p-3 bg-gray-50 rounded-md text-xs text-gray-800 overflow-x-auto whitespace-pre-wrap break-words">
        {logs}
      </pre>
    );
  }

  return (
    <div className="space-y-1">
      {parsed.map((entry, i) => {
        const message = typeof entry === "string" ? entry : entry.message || entry.msg || JSON.stringify(entry);
        const level = typeof entry === "object" ? (entry.level || entry.type || "") : "";
        const timestamp = typeof entry === "object" ? (entry.timestamp || entry.ts || "") : "";
        return (
          <div key={i} className="flex gap-2 text-xs font-mono">
            {timestamp && (
              <span className="text-gray-400 flex-shrink-0">
                {formatTimestamp(timestamp)}
              </span>
            )}
            {level && (
              <span
                className={`flex-shrink-0 ${
                  level === "error" ? "text-red-600" : level === "warn" ? "text-amber-600" : "text-gray-500"
                }`}
              >
                [{level}]
              </span>
            )}
            <span className="text-gray-800 break-all">{message}</span>
          </div>
        );
      })}
    </div>
  );
}
