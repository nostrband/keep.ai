import { DBInterface } from "@app/db";
import { BroadcastMessage, Change } from "./messages";
import debug from "debug";

const debugPeer = debug("worker:CRSqlitePeer");

export class CRSqlitePeer {
  private _db: DBInterface | (() => DBInterface);
  protected isStarted = false;
  protected lastDbVersion = 0;
  protected siteId: Uint8Array | null = null;
  private onChanges: (msg: BroadcastMessage) => Promise<void>;

  constructor(db: DBInterface | (() => DBInterface), onChanges: (msg: BroadcastMessage) => Promise<void>) {
    this._db = db;
    this.onChanges = onChanges;
  }

  get db(): DBInterface {
    return typeof this._db === "function" ? this._db() : this._db;
  }

  async start(): Promise<void> {
    if (this.isStarted) return;

    try {
      debugPeer("Starting...");

      // Initialize last db version before starting to send messages
      await this.initialize();

      this.isStarted = true;
      debugPeer("Started successfully");
    } catch (error) {
      debugPeer("Failed to start:", error);
      this.isStarted = false;
      throw error;
    }
  }

  async checkChanges(): Promise<void> {
    await this.broadcastChangesSinceLastVersion();
  }

  async processChanges(message: BroadcastMessage): Promise<Change[]> {
    debugPeer("Received broadcast message:", message);

    if (message.type === "changes" && message.data) {
      try {
        // Apply changes from tabs to persistent database
        return await this.applyChanges(message.data);
      } catch (error) {
        debugPeer("Error applying changes:", error);
        throw error;
      }
    }

    return [];
  }

  private arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  private async applyChanges(allChanges: Change[]): Promise<Change[]> {
    const changes = allChanges.filter(c => !this.arraysEqual(c.site_id, this.siteId!));
    if (changes.length === 0) return [];

    debugPeer(
      `Applying ${changes.length} changes to persistent database`
    );

    try {
      await this.db.tx(async (tx: DBInterface) => {
        for (const change of changes) {
          await tx.exec(
            `INSERT INTO crsql_changes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              change.table,
              change.pk,
              change.cid,
              change.val,
              change.col_version,
              change.db_version,
              change.site_id,
              change.cl,
              change.seq,
            ]
          );
        }
      });
      debugPeer(
        "Successfully applied changes to persistent database"
      );

      return changes;
    } catch (error) {
      debugPeer(
        "Error applying changes to database:",
        error
      );
      throw error;
    }
  }

  private async initialize(): Promise<void> {
    try {
      const dbVersion = await this.db.execO<{ db_version: number }>(
        "SELECT db_version FROM crsql_changes WHERE site_id = crsql_site_id() LIMIT 1"
      );
      this.lastDbVersion = dbVersion?.[0]?.db_version || 0;

      const siteId = await this.db.execO<{ site_id: Uint8Array }>(
        "SELECT crsql_site_id() as site_id;"
      );
      this.siteId = siteId?.[0]?.site_id || null;
      debugPeer(
        `Initialized lastDbVersion to ${this.lastDbVersion}`
      );
      debugPeer(
        `Initialized siteId to ${this.siteId}`
      );
    } catch (error) {
      debugPeer(
        "Error initializing last db version:",
        error
      );
      this.lastDbVersion = 0;
      this.siteId = null;
    }
  }

  private async broadcastChangesSinceLastVersion(): Promise<void> {
    try {
      // Only local changes, changes on other tabs should have been broadcasted through channel
      const changes = await this.db.execO<Change>(
        "SELECT * FROM crsql_changes WHERE db_version > ? AND site_id = crsql_site_id()",
        [this.lastDbVersion]
      );

      if (changes && changes.length > 0) {
        debugPeer(
          `Broadcasting ${changes.length} changes since version ${this.lastDbVersion}`
        );

        // Update last db version
        const maxVersion = Math.max(...changes.map((c) => c.db_version));
        this.lastDbVersion = maxVersion;

        // Call onChanges callback 
        await this.onChanges({
          type: "changes",
          data: changes,
        });
      }
    } catch (error) {
      debugPeer(
        "Error broadcasting changes:",
        error
      );
    }
  }

  stop(): void {
    this.isStarted = false;
    this.lastDbVersion = 0;
  }
}