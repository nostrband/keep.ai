# Keep.AI Overview

Keep.AI is a local automation assistant that helps you create and manage automated workflows through natural conversation.

## Core Concept

You describe what you want automated in plain language, and Keep.AI:
1. Creates a workflow based on your description
2. Generates a script to execute the automation
3. Runs it on your schedule
4. Handles issues automatically when possible
5. Notifies you only when your attention is needed

## Four Main Surfaces

| Surface | URL | Purpose |
|---------|-----|---------|
| **Home** | `/` | Overview of all workflows, quick creation |
| **Workflow** | `/workflows/{id}` | Status, runs, controls for one workflow |
| **Chat** | `/chats/{id}` | Edit workflow through AI conversation |
| **Notifications** | `/notifications` | Actionable items requiring attention |

See [Four User Surfaces](02-four-surfaces.md) for detailed descriptions.

## Key Features

### Conversational Creation
Type what you want automated in natural language. The AI understands your intent and creates the workflow for you.

### Automatic Error Handling
When scripts fail due to code issues, AI automatically attempts to fix them without bothering you. You're only notified when:
- Authentication expires (you need to reconnect)
- Permissions are denied (you need to grant access)
- Network failures persist (external service issues)
- AI can't fix it after multiple attempts

### Scheduled Execution
Workflows run automatically based on schedules you set - daily, hourly, or custom cron expressions.

## Getting Started

1. Go to the home page
2. Type what you'd like to automate (e.g., "Check my Gmail for newsletters every morning")
3. Chat with AI to refine the details
4. Review and activate the workflow
5. Let it run automatically
