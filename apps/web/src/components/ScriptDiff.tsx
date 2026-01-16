import React, { useMemo } from "react";

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

// Simple line-by-line diff algorithm using longest common subsequence
function computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const result: DiffLine[] = [];

  // Build LCS matrix
  const m = oldLines.length;
  const n = newLines.length;
  const lcs: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Backtrack to find diff
  let i = m;
  let j = n;
  const tempResult: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      tempResult.unshift({
        type: "unchanged",
        content: oldLines[i - 1],
        oldLineNum: i,
        newLineNum: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      tempResult.unshift({
        type: "added",
        content: newLines[j - 1],
        newLineNum: j,
      });
      j--;
    } else if (i > 0) {
      tempResult.unshift({
        type: "removed",
        content: oldLines[i - 1],
        oldLineNum: i,
      });
      i--;
    }
  }

  return tempResult;
}

export default function ScriptDiff({ oldCode, newCode, oldVersion, newVersion }: ScriptDiffProps) {
  const diffLines = useMemo(() => {
    const oldLines = oldCode.split("\n");
    const newLines = newCode.split("\n");
    return computeDiff(oldLines, newLines);
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
