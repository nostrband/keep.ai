## 2) Ask clarifying questions

### Goal

The system asks the minimum number of questions needed to make a deterministic script - ideally zero.

### UI

* Questions appear as assistant messages in the workflow chat
* User answers by replying in the chat (standard chat input)
* When task is in "wait" state, show "Waiting for your input" indicator

**Autonomy toggle (below input on main screen - see spec 00):**
* Subtle hint below input: "AI decides details ⓘ" (default) / "Coordinate with me ⓘ"
* Click toggles between modes, info icon explains behavior
* Choice persists as user preference
* When "AI decides details": agent minimizes questions, uses safe defaults, explores via eval
* When "Coordinate with me": agent confirms key decisions before proceeding

### Server/data

**Already implemented:**
* Agent uses `ask` tool to pause and store questions in `task.asks` field
* Task state becomes `"wait"` when agent calls `ask`
* User replies go to task `inbox`, triggering next agent run
* Agent has access to previous conversation via chat history

**Agent tools used:**
* `ask({ asks })` - Pauses task, stores questions
  * Note: `notes` and `plan` params commented out for now - not used
* `eval` - Tests code snippets to verify assumptions, explore user's data

### Agent policy (in system prompt)

**Core principle: Infer, don't interrogate.**

* Before asking ANY question:
  1. Parse everything possible from user's input
  2. Use `eval` to explore (e.g., fetch recent emails, check file formats)
  3. Only ask if truly ambiguous AND consequential

* Cap clarification to **max 3 questions** before proceeding with safe defaults
* When "Figure everything out" mode is active, aim for **zero questions**

**What agent should figure out via eval:**
* Trigger patterns (find example emails, check file structures)
* Data formats (parse an attachment, inspect API responses)
* Existing conventions (how user names things, folder structures)

**What might still need asking:**
* Destructive actions (delete vs archive)
* External recipients (who to send to)
* Ambiguous intent (two valid interpretations)

### Question format

**Keep questions extremely short. User should be able to answer yes/no or pick from options.**

Good examples:
* "Archive or delete the processed emails?"
* "Send summary to you, or also to team@company.com?"
* "Found 3 invoice formats. Should I handle all, or just PDFs?"

Bad examples:
* "I noticed you receive emails with invoices attached. These attachments come in various formats including PDF, PNG, and DOCX. Would you like me to process all attachment types, or would you prefer to focus on a specific format? Additionally, I should clarify whether you want to..."
* "Please select your preferred trigger type: [Schedule] [Event] [Manual]"

### Lovable detail

* Agent shows what it discovered: "Found 12 invoice emails from last month, all PDFs from accounting@vendor.com"
* Questions feel like a helpful assistant checking in, not a form to fill
* When using defaults, briefly state what was assumed: "Using daily at 9am since you didn't specify a time"
