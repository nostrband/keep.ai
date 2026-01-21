## 13) Modify an automation in natural language

### Goal

User can change automation behavior by chatting, without editing code.

### UI

* In workflow chat, user says:
  * "Only process invoices over $200"
  * "Change to run every hour instead of daily"
  * "Also send me a weekly summary"
* Agent makes changes based on autonomy mode

### Behavior by mode

**"AI decides details" mode:**
* Agent analyzes request and current script
* Agent makes the change directly
* Agent saves new version
* Agent confirms: "Done - now only processes invoices over $200. Updated to v3."

**"Coordinate with me" mode:**
* Agent proposes change first
* Waits for user approval
* Then saves new version

### Server/data

**Already implemented:**
* Conversation continues in workflow chat
* Agent uses `eval` to test changes
* Agent uses `save` to create new script version
* Agent uses `schedule` to update cron if needed
* All versions preserved in `scripts` table

**Modification flow (auto mode):**
1. User requests change in chat
2. Message goes to planner task inbox
3. Agent analyzes current script and requested change
4. Agent saves new script version
5. Agent updates schedule if needed
6. Agent confirms change in chat

### Version control

* Each `save()` creates new version (v1, v2, v3...)
* `change_comment` describes what changed
* Old versions preserved for potential rollback
* Summary and diagram regenerated for new version (spec 12)

### Lovable detail

* Changes confirmed briefly: "Updated to v3 - added $200 minimum filter"
* No walls of text explaining what changed
* User can view script versions on script page for details
