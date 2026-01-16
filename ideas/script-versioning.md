## 4) Script versioning

### Goal

Track script versions and enable rollback if needed.

### Status

**Mostly covered by spec 03. This spec is a placeholder for future versioning features.**

### Already implemented

* Each `save()` creates new version (v1, v2, v3...)
* `change_comment` describes what changed
* Old versions preserved in `scripts` table
* `Scripts.history(workflowId)` returns all versions

### Future considerations

* UI to view version history
* One-click rollback to previous version
* Diff view between versions
* Auto-rollback on repeated failures?
