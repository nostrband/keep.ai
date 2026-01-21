import React, { useMemo } from "react";
import { diffLines } from "diff";

interface ScriptDiffProps {
  oldCode: string;
  newCode: string;
  oldVersion: number;
  newVersion: number;
}

interface DiffLine {
  type: "unchanged" | "added" | "removed";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

// Maximum combined line count before refusing to diff (browser memory protection)
const MAX_DIFF_LINES = 50000;

function computeDiff(oldCode: string, newCode: string): DiffLine[] {
  const oldLines = oldCode.split("\n");
  const newLines = newCode.split("\n");

  // Safety check: refuse to diff extremely large files
  if (oldLines.length + newLines.length > MAX_DIFF_LINES) {
    return [
      {
        type: "removed",
        content: `[File too large to diff: ${oldLines.length} lines]`,
        oldLineNum: 1,
      },
      {
        type: "added",
        content: `[File too large to diff: ${newLines.length} lines]`,
        newLineNum: 1,
      },
    ];
  }

  // Use jsdiff library for battle-tested diffing with Myers algorithm
  const changes = diffLines(oldCode, newCode);

  const result: DiffLine[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;

  for (const change of changes) {
    // diffLines returns chunks that can contain multiple lines
    const lines = change.value.split("\n");
    // Remove the trailing empty string from split if the value ends with \n
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }

    for (const line of lines) {
      if (change.added) {
        result.push({
          type: "added",
          content: line,
          newLineNum: newLineNum++,
        });
      } else if (change.removed) {
        result.push({
          type: "removed",
          content: line,
          oldLineNum: oldLineNum++,
        });
      } else {
        // Unchanged
        result.push({
          type: "unchanged",
          content: line,
          oldLineNum: oldLineNum++,
          newLineNum: newLineNum++,
        });
      }
    }
  }

  return result;
}

export default function ScriptDiff({ oldCode, newCode, oldVersion, newVersion }: ScriptDiffProps) {
  const diffLines = useMemo(() => {
    return computeDiff(oldCode, newCode);
  }, [oldCode, newCode]);

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const line of diffLines) {
      if (line.type === "added") added++;
      if (line.type === "removed") removed++;
    }
    return { added, removed };
  }, [diffLines]);

  if (oldCode === newCode) {
    return (
      <div className="text-sm text-gray-500 italic py-4 text-center">
        No changes between versions
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gray-100 px-4 py-2 flex items-center justify-between border-b border-gray-200">
        <span className="text-sm text-gray-700">
          Comparing v{oldVersion} → v{newVersion}
        </span>
        <div className="flex items-center gap-3 text-sm">
          {stats.added > 0 && (
            <span className="text-green-700">+{stats.added} lines</span>
          )}
          {stats.removed > 0 && (
            <span className="text-red-700">-{stats.removed} lines</span>
          )}
        </div>
      </div>

      {/* Diff content */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-mono">
          <tbody>
            {diffLines.map((line, idx) => (
              <tr
                key={idx}
                className={
                  line.type === "added"
                    ? "bg-green-50"
                    : line.type === "removed"
                    ? "bg-red-50"
                    : ""
                }
              >
                {/* Old line number */}
                <td className="w-12 px-2 py-0.5 text-right text-gray-400 select-none border-r border-gray-200">
                  {line.oldLineNum || ""}
                </td>
                {/* New line number */}
                <td className="w-12 px-2 py-0.5 text-right text-gray-400 select-none border-r border-gray-200">
                  {line.newLineNum || ""}
                </td>
                {/* Change indicator */}
                <td className="w-6 px-1 py-0.5 text-center select-none">
                  {line.type === "added" && (
                    <span className="text-green-600 font-bold">+</span>
                  )}
                  {line.type === "removed" && (
                    <span className="text-red-600 font-bold">-</span>
                  )}
                </td>
                {/* Code content */}
                <td className="px-2 py-0.5 whitespace-pre">
                  <span
                    className={
                      line.type === "added"
                        ? "text-green-800"
                        : line.type === "removed"
                        ? "text-red-800"
                        : "text-gray-800"
                    }
                  >
                    {line.content || " "}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
