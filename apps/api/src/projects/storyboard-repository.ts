import { ObjectId, type Collection, type Document } from "mongodb";
import type { StoryboardContent, StoryboardResponse } from "@videogen/contracts";
import { storyboardResponseSchema } from "@videogen/contracts";
import type { MongoDatabase } from "@videogen/database";

interface StoryboardDocument extends Document {
  _id: ObjectId;
  workspaceId: ObjectId;
  projectId: ObjectId;
  version: number;
  status: "draft" | "approved";
  revision: number;
  content: StoryboardContent;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export class StoryboardRepository {
  private readonly projects: Collection<Document>;
  private readonly storyboards: Collection<StoryboardDocument>;
  private initialized: Promise<void> | undefined;

  constructor(private readonly mongo: MongoDatabase) {
    this.projects = mongo.database().collection("projects");
    this.storyboards = mongo.database().collection<StoryboardDocument>("storyboards");
  }

  async list(ownerUserId: string, projectId: ObjectId): Promise<StoryboardResponse[] | null> {
    const workspaceId = await this.workspaceFor(ownerUserId, projectId);
    if (!workspaceId) return null;
    const rows = await this.storyboards.find({ workspaceId, projectId }).sort({ version: -1 }).toArray();
    return rows.map((row) => this.toResponse(row));
  }

  async createVersion(ownerUserId: string, projectId: ObjectId, content: StoryboardContent): Promise<StoryboardResponse | null> {
    const workspaceId = await this.workspaceFor(ownerUserId, projectId);
    if (!workspaceId) return null;
    const project = await this.projects.findOne({ _id: projectId, workspaceId, status: "active" });
    if (!project) return null;
    const latest = await this.storyboards.find({ workspaceId, projectId }).sort({ version: -1 }).limit(1).next();
    const now = new Date();
    const row: StoryboardDocument = {
      _id: new ObjectId(), workspaceId, projectId, version: (latest?.version ?? 0) + 1,
      status: "draft", revision: 1, content, createdBy: ownerUserId, createdAt: now, updatedAt: now,
    };
    await this.storyboards.insertOne(row);
    return this.toResponse(row);
  }

  async updateDraft(ownerUserId: string, projectId: ObjectId, storyboardId: ObjectId, expectedRevision: number, content: StoryboardContent): Promise<StoryboardResponse | null> {
    const workspaceId = await this.workspaceFor(ownerUserId, projectId);
    if (!workspaceId) return null;
    const activeProject = await this.projects.findOne({ _id: projectId, workspaceId, status: "active" }, { projection: { _id: 1 } });
    if (!activeProject) return null;
    const row = await this.storyboards.findOneAndUpdate(
      { _id: storyboardId, workspaceId, projectId, status: "draft", revision: expectedRevision },
      { $set: { content, updatedAt: new Date() }, $inc: { revision: 1 } },
      { returnDocument: "after" },
    );
    if (!row) {
      const exists = await this.storyboards.findOne({ _id: storyboardId, workspaceId, projectId }, { projection: { _id: 1 } });
      if (exists) throw new StaleStoryboardRevisionError();
    }
    return row ? this.toResponse(row) : null;
  }

  async approve(ownerUserId: string, projectId: ObjectId, storyboardId: ObjectId, expectedRevision: number): Promise<StoryboardResponse | null> {
    const workspaceId = await this.workspaceFor(ownerUserId, projectId);
    if (!workspaceId) return null;
    const activeProject = await this.projects.findOne({ _id: projectId, workspaceId, status: "active" }, { projection: { _id: 1 } });
    if (!activeProject) return null;
    const row = await this.storyboards.findOneAndUpdate(
      { _id: storyboardId, workspaceId, projectId, status: "draft", revision: expectedRevision },
      { $set: { status: "approved", updatedAt: new Date() }, $inc: { revision: 1 } },
      { returnDocument: "after" },
    );
    if (!row) {
      const exists = await this.storyboards.findOne({ _id: storyboardId, workspaceId, projectId }, { projection: { _id: 1 } });
      if (exists) throw new StaleStoryboardRevisionError();
    }
    return row ? this.toResponse(row) : null;
  }

  private async workspaceFor(ownerUserId: string, projectId: ObjectId): Promise<ObjectId | null> {
    await this.ensureInitialized();
    const workspace = await this.mongo.database().collection<{ _id: ObjectId; ownerUserId: string }>("workspaces").findOne({ ownerUserId }, { projection: { _id: 1 } });
    if (!workspace) return null;
    const project = await this.projects.findOne({ _id: projectId, workspaceId: workspace._id }, { projection: { _id: 1 } });
    return project ? workspace._id : null;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) this.initialized = this.mongo.connect().then(async () => {
      await this.storyboards.createIndex({ workspaceId: 1, projectId: 1, version: 1 }, { unique: true, name: "uniq_storyboard_project_version" });
      await this.storyboards.createIndex({ workspaceId: 1, projectId: 1, createdAt: -1 }, { name: "storyboards_workspace_project_created" });
    }).catch((error: unknown) => { this.initialized = undefined; throw error; });
    return this.initialized;
  }

  private toResponse(row: StoryboardDocument): StoryboardResponse {
    return storyboardResponseSchema.parse({
      id: row._id.toHexString(), projectId: row.projectId.toHexString(), version: row.version,
      status: row.status, revision: row.revision, content: row.content,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    });
  }
}

export class StaleStoryboardRevisionError extends Error {
  constructor() { super("Storyboard revision is stale."); this.name = "StaleStoryboardRevisionError"; }
}
