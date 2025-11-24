import { useState, useEffect, useRef } from "react";
import { useDbQuery } from "../hooks/dbQuery";
import { Button, Textarea } from "../ui";
import SharedHeader from "./SharedHeader";

interface QueryResult {
  records: Record<string, unknown>[];
  totalRecords: number;
  outputLength: number;
  executionTime: number;
  error?: string;
}

export default function ConsolePage() {
  const { api, dbStatus } = useDbQuery();
  const [sqlQuery, setSqlQuery] = useState("");
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [modalContent, setModalContent] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const validateSelectOnly = (sql: string): boolean => {
    const trimmed = sql.trim().toLowerCase();
    console.log("🔍 Validating SQL:", {
      originalQuery: sql,
      trimmedLower: trimmed,
    });

    // Check if it starts with SELECT
    const isSelect = trimmed.startsWith("select");
    console.log("🔍 Is SELECT query:", isSelect);

    if (!isSelect) {
      console.log("❌ SQL Validation failed: Not a SELECT statement");
      return false;
    }

    // Check for dangerous keywords (basic protection)
    const dangerousKeywords = [
      "insert",
      "update",
      "delete",
      "drop",
      "create",
      "alter",
      "truncate",
      "vacuum",
    ];
    const hasDangerous =
      dangerousKeywords.some((keyword) =>
        trimmed.includes(keyword.toLowerCase())
      ) ||
      (trimmed.includes("pragma") && trimmed.includes("="));

    if (hasDangerous) {
      console.log("❌ SQL Validation failed: Contains dangerous keywords");
      return false;
    }

    console.log("✅ SQL Validation passed");
    return true;
  };

  const executeQuery = async () => {
    if (!api || !sqlQuery.trim()) {
      console.log("❌ Cannot execute: No API or empty query", {
        hasApi: !!api,
        queryLength: sqlQuery.length,
      });
      return;
    }

    console.log("🚀 Starting query execution...");
    setIsExecuting(true);
    const startTime = performance.now();

    try {
      // Validate SQL
      if (!validateSelectOnly(sqlQuery)) {
        throw new Error("Only SELECT statements are allowed");
      }

      console.log("📊 Executing SQL query via execO...");
      const result = await api.db.db.execO<Record<string, unknown>>(sqlQuery);
      const endTime = performance.now();

      console.log("✅ Query executed successfully", {
        resultType: typeof result,
        resultLength: result?.length || 0,
        executionTime: endTime - startTime,
      });

      const records = result || [];
      const outputLength = JSON.stringify(records).length;

      console.log("📈 Query stats:", {
        totalRecords: records.length,
        outputLength: outputLength,
        executionTime: endTime - startTime,
        memoryUsageEstimate: `${(outputLength / 1024 / 1024).toFixed(2)} MB`,
      });

      // Check for large result sets
      if (records.length > 1000) {
        console.log("⚠️ Large result set detected:", records.length, "records");
      }

      if (outputLength > 10 * 1024 * 1024) {
        // 10MB
        console.log(
          "⚠️ Large output size detected:",
          (outputLength / 1024 / 1024).toFixed(2),
          "MB"
        );
      }

      setQueryResult({
        records,
        totalRecords: records.length,
        outputLength,
        executionTime: endTime - startTime,
      });
    } catch (error) {
      const endTime = performance.now();
      console.log("❌ Query execution failed:", error);

      setQueryResult({
        records: [],
        totalRecords: 0,
        outputLength: 0,
        executionTime: endTime - startTime,
        error: (error as Error).message,
      });
    } finally {
      setIsExecuting(false);
      console.log("🏁 Query execution finished");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      executeQuery();
    }
  };

  const handleCellClick = (value: unknown) => {
    console.log("🔍 Cell clicked, showing modal with value:", {
      valueType: typeof value,
      valueLength: String(value).length,
    });
    const stringValue =
      value === null
        ? "null"
        : typeof value === "object"
        ? JSON.stringify(value, null, 2)
        : String(value);
    setModalContent(stringValue);
  };

  const closeModal = () => {
    console.log("🔍 Closing modal");
    setModalContent(null);
  };

  // Handle Esc key to close modal
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && modalContent !== null) {
        console.log("🔍 Escape key pressed, closing modal");
        closeModal();
      }
    };

    if (modalContent !== null) {
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [modalContent]);

  const insertCommonQuery = (query: string) => {
    console.log("📝 Inserting common query:", query);
    setSqlQuery(query);
    // Focus the textarea so user can immediately press Ctrl+Enter
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        console.log("📝 Focused textarea after inserting query");
      }
    }, 0);
  };

  const commonQueries = [
    {
      name: "Table schemas",
      query: `SELECT name, sql
FROM sqlite_master
WHERE type = 'table';`,
    },
    {
      name: "All tables",
      query: `SELECT name
FROM sqlite_master
WHERE type = 'table'
ORDER BY name;`,
    },
    {
      name: "Recent threads",
      query: `SELECT id, title, created_at, updated_at
FROM threads
ORDER BY updated_at DESC
LIMIT 10;`,
    },
  ];

  if (dbStatus !== "ready") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div>Database status: {dbStatus}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader
        title="Console"
        subtitle="Execute SELECT queries on the database. Press Ctrl+Enter to execute."
      />

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* SQL Input */}
        <div className="bg-white rounded-lg shadow mb-6 p-6">
          <Textarea
            ref={textareaRef}
            value={sqlQuery}
            onChange={(e) => setSqlQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="SELECT * FROM threads LIMIT 10;"
            className="min-h-32 font-mono text-sm mb-4"
          />

          {/* Common Query Buttons */}
          <div className="mb-4">
            <div className="text-xs text-gray-500 mb-2">Common queries:</div>
            <div className="flex flex-wrap gap-2">
              {commonQueries.map((item) => (
                <Button
                  key={item.name}
                  variant="outline"
                  size="sm"
                  onClick={() => insertCommonQuery(item.query)}
                  className="text-xs"
                >
                  {item.name}
                </Button>
              ))}
            </div>
          </div>

          <Button
            onClick={executeQuery}
            disabled={isExecuting || !sqlQuery.trim()}
            className="w-full sm:w-auto"
          >
            {isExecuting ? "Executing..." : "Execute Query (Ctrl+Enter)"}
          </Button>
        </div>

        {/* Query Stats */}
        {queryResult && (
          <div className="bg-white rounded-lg shadow mb-6 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">
              Query Statistics
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="font-medium text-gray-600">
                  Total Records:
                </span>
                <span className="ml-2 text-gray-900 font-mono">
                  {queryResult.totalRecords.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-600">Output Size:</span>
                <span className="ml-2 text-gray-900 font-mono">
                  {queryResult.outputLength > 1024
                    ? `${(queryResult.outputLength / 1024).toFixed(1)} KB`
                    : `${queryResult.outputLength} bytes`}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-600">
                  Execution Time:
                </span>
                <span className="ml-2 text-gray-900 font-mono">
                  {queryResult.executionTime.toFixed(2)} ms
                </span>
              </div>
            </div>
            {queryResult.error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-red-800 text-sm font-medium">Error:</p>
                <p className="text-red-700 text-sm font-mono mt-1">
                  {queryResult.error}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Results Table */}
        {queryResult &&
          !queryResult.error &&
          queryResult.records.length > 0 && (
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-800">
                  Query Results
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {Object.keys(queryResult.records[0]).map((column) => (
                        <th
                          key={column}
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50"
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {queryResult.records.map((record, index) => (
                      <tr
                        key={index}
                        className={index % 2 === 0 ? "bg-white" : "bg-gray-50"}
                      >
                        {Object.values(record).map((value, cellIndex) => (
                          <td
                            key={cellIndex}
                            className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-mono max-w-xs overflow-hidden text-ellipsis cursor-pointer hover:bg-blue-50"
                            title="Click to view full content"
                            onClick={() => handleCellClick(value)}
                          >
                            {value === null ? (
                              <span className="text-gray-400 italic">null</span>
                            ) : typeof value === "object" ? (
                              JSON.stringify(value)
                            ) : (
                              String(value)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        {queryResult &&
          !queryResult.error &&
          queryResult.records.length === 0 && (
            <div className="bg-white rounded-lg shadow p-6 text-center">
              <p className="text-gray-500">No records found</p>
            </div>
          )}
      </div>

      {/* Cell Content Modal */}
      {modalContent !== null && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={closeModal}
        >
          <div
            className="bg-white rounded-lg shadow-lg max-w-4xl w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">
                Cell Content
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={closeModal}
                className="h-8 w-8 p-0"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </Button>
            </div>
            <div className="px-6 py-4 flex-1 overflow-hidden">
              <Textarea
                value={modalContent}
                readOnly
                className="w-full h-full min-h-64 font-mono text-sm resize-none"
                placeholder="Cell content will appear here..."
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <Button variant="outline" onClick={closeModal}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
