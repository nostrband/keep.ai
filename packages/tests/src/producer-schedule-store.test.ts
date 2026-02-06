import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, ProducerScheduleStore, ProducerSchedule } from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Helper to create producer_schedules table without full migration system.
 * Schema matches packages/db/src/migrations/v43.ts
 */
async function createProducerSchedulesTable(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS producer_schedules (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      producer_name TEXT NOT NULL DEFAULT '',
      schedule_type TEXT NOT NULL DEFAULT '',
      schedule_value TEXT NOT NULL DEFAULT '',
      next_run_at INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(workflow_id, producer_name)
    )
  `);
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_producer_schedules_workflow ON producer_schedules(workflow_id)`
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_producer_schedules_next_run ON producer_schedules(next_run_at)`
  );
}

describe("ProducerScheduleStore", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let store: ProducerScheduleStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createProducerSchedulesTable(db);
    store = new ProducerScheduleStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("upsert and get", () => {
    it("should create a new schedule", async () => {
      const nextRunAt = Date.now() + 300000; // 5 minutes from now
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "checkEmails",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: nextRunAt,
      });

      const schedule = await store.get("workflow-1", "checkEmails");

      expect(schedule).not.toBeNull();
      expect(schedule?.workflow_id).toBe("workflow-1");
      expect(schedule?.producer_name).toBe("checkEmails");
      expect(schedule?.schedule_type).toBe("interval");
      expect(schedule?.schedule_value).toBe("5m");
      expect(schedule?.next_run_at).toBe(nextRunAt);
      expect(schedule?.last_run_at).toBe(0); // Not run yet
      expect(schedule?.id).toBeDefined();
      expect(schedule?.created_at).toBeGreaterThan(0);
      expect(schedule?.updated_at).toBeGreaterThan(0);
    });

    it("should return null for non-existent schedule", async () => {
      const schedule = await store.get("workflow-1", "nonexistent");
      expect(schedule).toBeNull();
    });

    it("should update existing schedule", async () => {
      const initialNextRun = Date.now() + 300000;
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "checkEmails",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: initialNextRun,
      });

      const updatedNextRun = Date.now() + 600000;
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "checkEmails",
        schedule_type: "interval",
        schedule_value: "10m",
        next_run_at: updatedNextRun,
      });

      const schedule = await store.get("workflow-1", "checkEmails");

      expect(schedule?.schedule_value).toBe("10m");
      expect(schedule?.next_run_at).toBe(updatedNextRun);
    });

    it("should handle cron schedule type", async () => {
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "dailyReport",
        schedule_type: "cron",
        schedule_value: "0 9 * * *",
        next_run_at: Date.now() + 86400000, // ~1 day
      });

      const schedule = await store.get("workflow-1", "dailyReport");

      expect(schedule?.schedule_type).toBe("cron");
      expect(schedule?.schedule_value).toBe("0 9 * * *");
    });

    it("should handle different producers in same workflow", async () => {
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producerA",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: Date.now() + 300000,
      });

      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producerB",
        schedule_type: "cron",
        schedule_value: "0 */2 * * *",
        next_run_at: Date.now() + 7200000,
      });

      const scheduleA = await store.get("workflow-1", "producerA");
      const scheduleB = await store.get("workflow-1", "producerB");

      expect(scheduleA?.schedule_value).toBe("5m");
      expect(scheduleB?.schedule_value).toBe("0 */2 * * *");
    });

    it("should handle same producer name in different workflows", async () => {
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "checkEmails",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: Date.now() + 300000,
      });

      await store.upsert({
        workflow_id: "workflow-2",
        producer_name: "checkEmails",
        schedule_type: "interval",
        schedule_value: "10m",
        next_run_at: Date.now() + 600000,
      });

      const schedule1 = await store.get("workflow-1", "checkEmails");
      const schedule2 = await store.get("workflow-2", "checkEmails");

      expect(schedule1?.schedule_value).toBe("5m");
      expect(schedule2?.schedule_value).toBe("10m");
    });
  });

  describe("getForWorkflow", () => {
    it("should return all schedules for a workflow ordered by next_run_at", async () => {
      const now = Date.now();
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producerC",
        schedule_type: "interval",
        schedule_value: "15m",
        next_run_at: now + 900000, // 15 min
      });

      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producerA",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: now + 300000, // 5 min (earliest)
      });

      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producerB",
        schedule_type: "interval",
        schedule_value: "10m",
        next_run_at: now + 600000, // 10 min
      });

      await store.upsert({
        workflow_id: "workflow-2",
        producer_name: "other",
        schedule_type: "interval",
        schedule_value: "1m",
        next_run_at: now + 60000,
      });

      const schedules = await store.getForWorkflow("workflow-1");

      expect(schedules).toHaveLength(3);
      // Should be ordered by next_run_at
      expect(schedules[0].producer_name).toBe("producerA");
      expect(schedules[1].producer_name).toBe("producerB");
      expect(schedules[2].producer_name).toBe("producerC");
    });

    it("should return empty array for workflow with no schedules", async () => {
      const schedules = await store.getForWorkflow("nonexistent");
      expect(schedules).toEqual([]);
    });
  });

  describe("getDueProducers", () => {
    it("should return producers that are due to run", async () => {
      const now = Date.now();
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "pastDue",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: now - 1000, // 1 second ago
      });

      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "exactlyNow",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: now, // Right now
      });

      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "future",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: now + 300000, // 5 min in future
      });

      const dueProducers = await store.getDueProducers("workflow-1");

      expect(dueProducers).toHaveLength(2);
      expect(dueProducers.map((p) => p.producer_name).sort()).toEqual([
        "exactlyNow",
        "pastDue",
      ]);
    });

    it("should return empty array when no producers are due", async () => {
      const now = Date.now();
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "future",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: now + 300000,
      });

      const dueProducers = await store.getDueProducers("workflow-1");
      expect(dueProducers).toEqual([]);
    });

    it("should only return due producers for specified workflow", async () => {
      const now = Date.now();
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producer1",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: now - 1000,
      });

      await store.upsert({
        workflow_id: "workflow-2",
        producer_name: "producer2",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: now - 1000,
      });

      const dueProducers = await store.getDueProducers("workflow-1");

      expect(dueProducers).toHaveLength(1);
      expect(dueProducers[0].producer_name).toBe("producer1");
    });
  });

  describe("getNextScheduledTime", () => {
    it("should return the earliest next_run_at across all producers", async () => {
      const now = Date.now();
      const earliest = now + 60000; // 1 min

      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producerA",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: now + 300000,
      });

      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producerB",
        schedule_type: "interval",
        schedule_value: "1m",
        next_run_at: earliest, // This is earliest
      });

      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producerC",
        schedule_type: "interval",
        schedule_value: "10m",
        next_run_at: now + 600000,
      });

      const nextTime = await store.getNextScheduledTime("workflow-1");
      expect(nextTime).toBe(earliest);
    });

    it("should return null for workflow with no schedules", async () => {
      const nextTime = await store.getNextScheduledTime("nonexistent");
      expect(nextTime).toBeNull();
    });

    it("should only consider schedules for specified workflow", async () => {
      const now = Date.now();
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producer1",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: now + 300000,
      });

      await store.upsert({
        workflow_id: "workflow-2",
        producer_name: "producer2",
        schedule_type: "interval",
        schedule_value: "1m",
        next_run_at: now + 60000, // Earlier but different workflow
      });

      const nextTime = await store.getNextScheduledTime("workflow-1");
      expect(nextTime).toBe(now + 300000);
    });
  });

  describe("updateAfterRun", () => {
    it("should update last_run_at and next_run_at after producer runs", async () => {
      const initialNextRun = Date.now();
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "checkEmails",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: initialNextRun,
      });

      const beforeUpdate = Date.now();
      const newNextRun = Date.now() + 300000;
      await store.updateAfterRun("workflow-1", "checkEmails", newNextRun);

      const schedule = await store.get("workflow-1", "checkEmails");

      expect(schedule?.next_run_at).toBe(newNextRun);
      expect(schedule?.last_run_at).toBeGreaterThanOrEqual(beforeUpdate);
      expect(schedule?.updated_at).toBeGreaterThanOrEqual(beforeUpdate);
    });

    it("should preserve other schedule fields", async () => {
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "checkEmails",
        schedule_type: "cron",
        schedule_value: "0 9 * * *",
        next_run_at: Date.now(),
      });

      const beforeUpdate = await store.get("workflow-1", "checkEmails");

      await store.updateAfterRun(
        "workflow-1",
        "checkEmails",
        Date.now() + 86400000
      );

      const afterUpdate = await store.get("workflow-1", "checkEmails");

      expect(afterUpdate?.id).toBe(beforeUpdate?.id);
      expect(afterUpdate?.schedule_type).toBe("cron");
      expect(afterUpdate?.schedule_value).toBe("0 9 * * *");
      expect(afterUpdate?.created_at).toBe(beforeUpdate?.created_at);
    });
  });

  describe("delete", () => {
    it("should delete a specific producer schedule", async () => {
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producerA",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: Date.now() + 300000,
      });

      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producerB",
        schedule_type: "interval",
        schedule_value: "10m",
        next_run_at: Date.now() + 600000,
      });

      await store.delete("workflow-1", "producerA");

      const deletedSchedule = await store.get("workflow-1", "producerA");
      const remainingSchedule = await store.get("workflow-1", "producerB");

      expect(deletedSchedule).toBeNull();
      expect(remainingSchedule).not.toBeNull();
    });

    it("should not throw for non-existent schedule", async () => {
      await expect(
        store.delete("workflow-1", "nonexistent")
      ).resolves.not.toThrow();
    });
  });

  describe("deleteByWorkflow", () => {
    it("should delete all schedules for a workflow", async () => {
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producerA",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: Date.now() + 300000,
      });

      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producerB",
        schedule_type: "interval",
        schedule_value: "10m",
        next_run_at: Date.now() + 600000,
      });

      await store.upsert({
        workflow_id: "workflow-2",
        producer_name: "producer",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: Date.now() + 300000,
      });

      await store.deleteByWorkflow("workflow-1");

      const workflow1Schedules = await store.getForWorkflow("workflow-1");
      const workflow2Schedules = await store.getForWorkflow("workflow-2");

      expect(workflow1Schedules).toHaveLength(0);
      expect(workflow2Schedules).toHaveLength(1);
    });

    it("should not throw for workflow with no schedules", async () => {
      await expect(
        store.deleteByWorkflow("nonexistent")
      ).resolves.not.toThrow();
    });
  });

  describe("independent producer scheduling (exec-13)", () => {
    it("should allow producers to have independent schedules", async () => {
      const now = Date.now();

      // Producer A runs every 5 minutes
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "frequentCheck",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: now + 300000,
      });

      // Producer B runs once daily
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "dailyReport",
        schedule_type: "cron",
        schedule_value: "0 9 * * *",
        next_run_at: now + 86400000,
      });

      // Producer A runs - update its schedule
      await store.updateAfterRun(
        "workflow-1",
        "frequentCheck",
        now + 600000 // Next run in 10 minutes from now
      );

      // Verify Producer A updated independently
      const scheduleA = await store.get("workflow-1", "frequentCheck");
      const scheduleB = await store.get("workflow-1", "dailyReport");

      expect(scheduleA?.next_run_at).toBe(now + 600000);
      expect(scheduleA?.last_run_at).toBeGreaterThanOrEqual(now);

      // Producer B should be unaffected
      expect(scheduleB?.next_run_at).toBe(now + 86400000);
      expect(scheduleB?.last_run_at).toBe(0); // Never run
    });

    it("should correctly identify multiple due producers independently", async () => {
      const now = Date.now();

      // Both producers are past due
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producerA",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: now - 60000, // 1 minute ago
      });

      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producerB",
        schedule_type: "interval",
        schedule_value: "10m",
        next_run_at: now - 30000, // 30 seconds ago
      });

      const dueProducers = await store.getDueProducers("workflow-1");

      expect(dueProducers).toHaveLength(2);

      // Run producer A only
      await store.updateAfterRun(
        "workflow-1",
        "producerA",
        now + 300000 // Next run in 5 minutes
      );

      // Now only producer B should be due
      const stillDue = await store.getDueProducers("workflow-1");

      expect(stillDue).toHaveLength(1);
      expect(stillDue[0].producer_name).toBe("producerB");
    });
  });

  describe("timestamp handling", () => {
    it("should correctly handle millisecond timestamps", async () => {
      const exactTime = 1704067200000; // 2024-01-01 00:00:00.000 UTC

      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producer",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: exactTime,
      });

      const schedule = await store.get("workflow-1", "producer");
      expect(schedule?.next_run_at).toBe(exactTime);
    });

    it("should handle zero timestamp for past-due schedules", async () => {
      await store.upsert({
        workflow_id: "workflow-1",
        producer_name: "producer",
        schedule_type: "interval",
        schedule_value: "5m",
        next_run_at: 0, // Immediately due
      });

      const dueProducers = await store.getDueProducers("workflow-1");
      expect(dueProducers).toHaveLength(1);
    });
  });
});
