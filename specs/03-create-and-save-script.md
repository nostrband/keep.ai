## 3) Create and save script

### Goal

Agent creates a working script and saves it as a draft. User activates it when ready.

### Flow by mode

**"AI decides details" mode:**
1. Agent parses user request
2. Agent uses `eval` to explore data, test APIs
3. Agent builds complete script
4. Agent calls `save({ code, comments })` to persist
5. Agent calls `schedule({ cron })` to set timing
6. Workflow stays in Draft status
7. Agent responds: "Done! I created [brief description]. It will run [schedule]. Activate when ready."
8. UI shows "Activate" button

**"Coordinate with me" mode:**
1. Agent discusses approach with user (open-ended back-and-forth)
2. When user is satisfied, agent builds script
3. Same steps 4-8 as above

### UI

**After script is saved:**
* Chat shows agent's summary of what was created
* Prominent "Activate" button appears in workflow header or inline
* Button text: "Activate" or "Start automation"
* Workflow status remains "Draft" until user clicks

**Agent's completion message should include:**
* What it does (one sentence)
* When it runs (human-readable schedule)
* What it reads/writes (brief)

Example: "Done! I'll check your Gmail daily at 9am for invoice emails and send you a Telegram summary. Activate when ready."

### Server/data

**Already implemented via `save` tool:**
* Creates `script` row with `workflow_id`, `code`, `version`, `change_comment`
* Creates `chat_event` with type `"add_script"`

**Add to `save` tool:**
* `summary` - one-sentence description of what script does
* `diagram` - mermaid diagram of automation flow (see spec 12)

**Already implemented via `schedule` tool:**
* Sets `workflow.cron` expression
* Calculates `workflow.next_run_timestamp`
* Workflow status stays `""` (Draft) - agent cannot activate

**Activation (user action - see spec 06):**
* User clicks "Activate" → sets `workflow.status = "active"`

### Implementation constraints

Script must be:
* Deterministic control flow (no random behavior)
* Uses sandbox APIs: `Gmail.api()`, `Memory.*`, `Web.*`, `Files.*`, etc.
* Logs via `Console.log()` for debugging
* Handles errors gracefully (try/catch)
* Bounded operations (no infinite loops)

### Why user activates, not AI

* Scripts are potentially insecure code running with user's credentials
* Explicit user action = informed consent
* Clear security boundary between AI creation and execution

### Lovable detail

* Agent explains what it built in plain English, not code
* Version history preserved - can see all script versions
* "Activate" button feels like flipping a switch - satisfying moment
