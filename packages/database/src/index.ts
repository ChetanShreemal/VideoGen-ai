import { MongoClient, type Db } from "mongodb";

export interface MongoDatabaseOptions {
  uri: string;
  databaseName: string;
  serverSelectionTimeoutMS?: number;
}

export class MongoDatabase {
  private client: MongoClient | undefined;
  private db: Db | undefined;
  private connecting: Promise<void> | undefined;

  constructor(private readonly options: MongoDatabaseOptions) {}

  async connect(): Promise<void> {
    if (this.db) return;
    if (this.connecting) return this.connecting;

    this.connecting = this.openConnection().finally(() => {
      this.connecting = undefined;
    });

    return this.connecting;
  }

  async ping(): Promise<void> {
    await this.connect();
    await this.db?.command({ ping: 1 });
  }

  database(): Db {
    if (!this.db) {
      throw new Error("MongoDB is not connected.");
    }
    return this.db;
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.db = undefined;
    await client?.close();
  }

  private async openConnection(): Promise<void> {
    const client = new MongoClient(this.options.uri, {
      appName: "videogen-api",
      serverSelectionTimeoutMS: this.options.serverSelectionTimeoutMS ?? 3_000,
    });

    try {
      await client.connect();
      const db = client.db(this.options.databaseName);
      await db.command({ ping: 1 });
      this.client = client;
      this.db = db;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }
}
