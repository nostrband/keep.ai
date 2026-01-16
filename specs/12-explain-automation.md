## 12) Explain what an automation does

### Goal

User can understand what an automation does at a glance via structured explanation on workflow page.

### UI

**Workflow detail page shows:**
* **Summary**: One-sentence description of what it does
* **Trigger**: When it runs (human-readable schedule)
* **Steps**: What it does, as a list or mermaid diagram
* **Data**: What it reads/writes

**Mermaid diagram:**
* Visual flowchart of automation logic
* Shows: trigger → steps → output
* Embedded on workflow page (not in chat)

**Chat fallback:**
* User can still ask "what does this do?" in workflow chat
* Agent generates explanation from script + run history

### When explanation is generated

* Agent produces summary + diagram when saving script (spec 03)
* Stored with script version
* Updated on each new version

### Server/data

**Add to `script` row:**
* `summary` - one-sentence description
* `diagram` - mermaid diagram source

**Agent generates from:**
* Script code analysis
* Recent `script_runs` for context
* Tools/APIs used

### Explanation structure

* **Summary**: "Checks Gmail daily at 9am for invoice emails and sends you a Telegram summary"
* **Trigger**: "Daily at 9:00 AM"
* **Steps**:
  1. Fetch unread emails matching "invoice"
  2. Extract sender and amount from each
  3. Format summary message
  4. Send to Telegram
* **Data accessed**: Gmail (read), Telegram (write)

### Lovable detail

* Diagram makes complex automations scannable
* Non-technical users can verify behavior visually
* Link to script code for technical users who want to see actual code
