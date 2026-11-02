import { MongoClient, type Db } from "mongodb";

export interface MongoDatabaseOptions {
  uri: string;
  databaseName: string;
  serverSelectionTimeoutMS?: number;
}

export class MongoDatabase {
  private readonly client: MongoClient;
  private readonly db: Db;
  private connected = false;
  private connecting: Promise<void> | undefined;

  constructor(private readonly options: MongoDatabaseOptions) {
    this.client = new MongoClient(options.uri, {
      appName: "videogen-api",
      serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? 3_000,
    });
    this.db = this.client.db(options.databaseName);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;

    this.connecting = this.openConnection().finally(() => {
      this.connecting = undefined;
    });

    return this.connecting;
  }

  async ping(): Promise<void> {
    await this.connect();
    await this.db.command({ ping: 1 });
  }

  database(): Db {
    return this.db;
  }

  clientHandle(): MongoClient {
    return this.client;
  }

  async close(): Promise<void> {
    await this.client.close();
    this.connected = false;
  }

  private async openConnection(): Promise<void> {
    await this.client.connect();
    await this.db.command({ ping: 1 });
    this.connected = true;
  }
}
