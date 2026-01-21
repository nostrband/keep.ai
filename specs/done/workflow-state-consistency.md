# Spec: Workflow State Consistency

## Problem
Workflow records can be updated by UI (user actions) and backend (scheduler/worker) concurrently. Multiple places use a stale workflow object with spread operator pattern (`{ ...workflow, field: value }`), which overwrites all fields including those that may have been modified concurrently.

### Concurrent Update Scenarios
1. **User pauses while workflow running** - User clicks Pause in UI, but worker's post-execution update overwrites status back to active
2. **Maintenance mode overwritten** - Worker sets maintenance=true, but scheduler's post-execution update resets it to false
3. **Multiple field updates** - Any update using stale workflow object can overwrite concurrent changes to other fields

### Update Locations Found

**Scheduler (`workflow-scheduler.ts` lines 252-285):**
- Updates after workflow execution using stale object from before execution
- Fields: next_run_timestamp, timestamp, status

**Worker (`workflow-worker.ts` multiple locations):**
- Some use targeted methods (setWorkflowMaintenance, incrementMaintenanceFixCount) - safe
- Some use stale object pattern for status updates - unsafe

**AI Tools (`save.ts`, `schedule.ts`):**
- Use stale workflow objects for maintenance and cron updates

**UI (`dbWrites.ts`):**
- Fetches fresh workflow before update - safe

## Desired Behavior
Updates from scheduler/worker should only modify the specific fields they intend to change, without overwriting fields that may have been modified by the user or other processes.

## Considerations
- Should updates use targeted field-specific methods instead of full object replacement?
- Should the scheduler reload workflow after execution before updating?
- Should updateWorkflow accept partial updates (only specified fields)?
- How to handle conflicting updates (e.g., user paused but worker wants to set status to error)?
