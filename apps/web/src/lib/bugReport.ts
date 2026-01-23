/**
 * Bug Report URL Generator
 *
 * Creates GitHub issue URLs with pre-filled context for error reporting.
 * This helps users quickly report issues while providing developers
 * with the context they need to diagnose problems.
 */

// Configuration - can be changed when the repo is set up
const GITHUB_REPO = "anthropics/keep-ai";
const GITHUB_ISSUES_URL = `https://github.com/${GITHUB_REPO}/issues/new`;

export interface BugReportContext {
  /** Error type (auth, permission, network, internal) */
  errorType?: string;
  /** Service that caused the error (e.g., Gmail, Notion) */
  service?: string;
  /** Error message */
  message?: string;
  /** Workflow ID */
  workflowId?: string;
  /** Workflow title */
  workflowTitle?: string;
  /** When the error occurred */
  timestamp?: string;
}

/**
 * Generate a GitHub issue URL with pre-filled context.
 *
 * The URL encodes the error context into the issue body,
 * making it easy for users to submit bug reports with all
 * the information developers need.
 */
export function generateBugReportUrl(context: BugReportContext): string {
  const title = formatIssueTitle(context);
  const body = formatIssueBody(context);

  const params = new URLSearchParams({
    title,
    body,
    labels: "bug,user-reported",
  });

  return `${GITHUB_ISSUES_URL}?${params.toString()}`;
}

function formatIssueTitle(context: BugReportContext): string {
  const parts = ["[Bug]"];

  if (context.errorType) {
    const typeLabel = {
      auth: "Auth",
      permission: "Permission",
      network: "Network",
      internal: "Internal",
    }[context.errorType] || context.errorType;
    parts.push(`${typeLabel} Error`);
  }

  if (context.service) {
    parts.push(`in ${context.service}`);
  }

  return parts.join(" ");
}

function formatIssueBody(context: BugReportContext): string {
  const sections: string[] = [];

  // Description placeholder
  sections.push("## Description");
  sections.push("<!-- Please describe what you were trying to do when this error occurred -->\n");

  // Error details section
  sections.push("## Error Details");

  const details: string[] = [];
  if (context.errorType) {
    details.push(`- **Error Type:** ${context.errorType}`);
  }
  if (context.service) {
    details.push(`- **Service:** ${context.service}`);
  }
  if (context.message) {
    // Truncate long messages
    const message = context.message.length > 500
      ? context.message.slice(0, 500) + "..."
      : context.message;
    details.push(`- **Message:** ${message}`);
  }
  if (context.workflowTitle) {
    details.push(`- **Workflow:** ${context.workflowTitle}`);
  }
  if (context.timestamp) {
    details.push(`- **Timestamp:** ${context.timestamp}`);
  }

  sections.push(details.join("\n"));

  // Steps to reproduce
  sections.push("\n## Steps to Reproduce");
  sections.push("1. \n2. \n3. ");

  // Expected vs actual
  sections.push("\n## Expected Behavior");
  sections.push("<!-- What did you expect to happen? -->\n");

  sections.push("## Actual Behavior");
  sections.push("<!-- What actually happened? -->\n");

  // Environment footer
  sections.push("---");
  sections.push("*This issue was created from the Keep.AI error reporting feature.*");

  return sections.join("\n");
}

/**
 * Open the bug report URL in a new tab.
 */
export function openBugReport(context: BugReportContext): void {
  const url = generateBugReportUrl(context);
  window.open(url, "_blank", "noopener,noreferrer");
}
