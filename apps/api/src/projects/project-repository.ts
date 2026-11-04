import { createHmac, timingSafeEqual } from "node:crypto";
import { ObjectId, type Collection, type Db, type Document } from "mongodb";
import { z } from "zod";
import type { CreateProjectRequest, ListProjectsQuery, ProjectResponse, UpdateProjectRequest } from "@videogen/contracts";
import type { MongoDatabase } from "@videogen/database";

interface WorkspaceDocument extends Document {
  _id: ObjectId;
  ownerUserId: string;
  status: "active";
  createdAt: Date;
  updatedAt: Date;
}

interface ProjectDocument extends Document {
  _id: ObjectId;
  workspaceId: ObjectId;
  createdBy: string;
  title: string;
  topic?: string;
  settings: NonNullable<CreateProjectRequest["settings"]>;
  status: "active" | "archived";
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const cursorPayloadSchema = z.object({
  workspaceId: z.string().regex(/^[a-f\d]{24}$/i),
  status: z.enum(["active", "archived"]),
  updatedAt: z.iso.datetime(),
  id: z.string().regex(/^[a-f\d]{24}$/i),
}).strict();

export class ProjectRepository {
  private readonly mongo: MongoDatabase;
  private readonly database: Db;
  private readonly workspaces: Collection<WorkspaceDocument>;
  private readonly projects: Collection<ProjectDocument>;
  private initialization: Promise<void> | undefined;

  constructor(mongo: MongoDatabase, private readonly cursorSecret: string) {
    this.mongo = mongo;
    this.database = mongo.database();
    this.workspaces = this.database.collection<WorkspaceDocument>("workspaces");
    this.projects = this.database.collection<ProjectDocument>("projects");
  }

  async ensurePersonalWorkspace(ownerUserId: string): Promise<ObjectId> {
    await this.ensureInitialized();
    const now = new Date();
    await this.workspaces.updateOne(
      { ownerUserId },
      { $setOnInsert: { ownerUserId, status: "active", createdAt: now, updatedAt: now } },
      { upsert: true },
    );
    const workspace = await this.workspaces.findOne({ ownerUserId }, { projection: { _id: 1 } });
    if (!workspace) throw new Error("Personal workspace could not be resolved.");
    return workspace._id;
  }

  async create(ownerUserId: string, input: CreateProjectRequest): Promise<ProjectResponse> {
    const workspaceId = await this.ensurePersonalWorkspace(ownerUserId);
    const now = new Date();
    const project: ProjectDocument = {
      _id: new ObjectId(),
      workspaceId,
      createdBy: ownerUserId,
      title: input.title,
      ...(input.topic === undefined ? {} : { topic: input.topic }),
      settings: input.settings ?? {},
      status: "active",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.projects.insertOne(project);
    return this.toResponse(project);
  }

  async list(ownerUserId: string, query: ListProjectsQuery): Promise<{ items: ProjectResponse[]; nextCursor: string | null }> {
    const workspaceId = await this.ensurePersonalWorkspace(ownerUserId);
    const cursor = query.cursor ? this.decodeCursor(query.cursor, workspaceId, query.status) : undefined;
    const filter: Document = {
      workspaceId,
      status: query.status,
      ...(cursor
        ? {
            $or: [
              { updatedAt: { $lt: cursor.updatedAt } },
              { updatedAt: cursor.updatedAt, _id: { $lt: cursor.id } },
            ],
          }
        : {}),
    };
    const rows = await this.projects.find(filter).sort({ updatedAt: -1, _id: -1 }).limit(query.limit + 1).toArray();
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map((project) => this.toResponse(project)),
      nextCursor: hasMore && last ? this.encodeCursor(workspaceId, query.status, last) : null,
    };
  }

  async get(ownerUserId: string, projectId: ObjectId): Promise<ProjectResponse | null> {
    const workspaceId = await this.ensurePersonalWorkspace(ownerUserId);
    const project = await this.projects.findOne({ _id: projectId, workspaceId });
    return project ? this.toResponse(project) : null;
  }

  async update(ownerUserId: string, projectId: ObjectId, input: UpdateProjectRequest): Promise<ProjectResponse | null> {
    const workspaceId = await this.ensurePersonalWorkspace(ownerUserId);
    const set: Document = { updatedAt: new Date() };
    if (input.title !== undefined) set.title = input.title;
    if (input.topic !== undefined) {
      if (input.topic !== null && input.topic !== "") set.topic = input.topic;
    }
    if (input.settings !== undefined) set.settings = input.settings;
    const update: Document = { $set: set, $inc: { revision: 1 } };
    if (input.topic === null || input.topic === "") update.$unset = { topic: "" };
    const result = await this.projects.findOneAndUpdate(
      { _id: projectId, workspaceId, status: "active" }, update, { returnDocument: "after" },
    );
    return result ? this.toResponse(result) : null;
  }

  async archive(ownerUserId: string, projectId: ObjectId): Promise<ProjectResponse | null> {
    return this.changeStatus(ownerUserId, projectId, "active", "archived");
  }

  async restore(ownerUserId: string, projectId: ObjectId): Promise<ProjectResponse | null> {
    return this.changeStatus(ownerUserId, projectId, "archived", "active");
  }

  private async changeStatus(
    ownerUserId: string,
    projectId: ObjectId,
    from: ProjectDocument["status"],
    to: ProjectDocument["status"],
  ): Promise<ProjectResponse | null> {
    const workspaceId = await this.ensurePersonalWorkspace(ownerUserId);
    const project = await this.projects.findOneAndUpdate(
      { _id: projectId, workspaceId, status: from },
      { $set: { status: to, updatedAt: new Date() }, $inc: { revision: 1 } },
      { returnDocument: "after" },
    );
    return project ? this.toResponse(project) : null;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.initialize().catch((error: unknown) => {
        this.initialization = undefined;
        throw error;
      });
    }
    return this.initialization;
  }

  private async initialize(): Promise<void> {
    await this.mongo.connect();
    await this.workspaces.createIndex({ ownerUserId: 1 }, { unique: true, name: "uniq_personal_workspace_owner" });
    await this.projects.createIndex(
      { workspaceId: 1, status: 1, updatedAt: -1, _id: -1 },
      { name: "projects_workspace_status_updated_id" },
    );
  }

  private toResponse(project: ProjectDocument): ProjectResponse {
    return {
      id: project._id.toHexString(),
      title: project.title,
      ...(project.topic === undefined ? {} : { topic: project.topic }),
      settings: project.settings,
      status: project.status,
      revision: project.revision,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }

  private encodeCursor(workspaceId: ObjectId, status: "active" | "archived", project: ProjectDocument): string {
    const payload = Buffer.from(JSON.stringify({
      workspaceId: workspaceId.toHexString(),
      status,
      updatedAt: project.updatedAt.toISOString(),
      id: project._id.toHexString(),
    })).toString("base64url");
    const signature = createHmac("sha256", this.cursorSecret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  private decodeCursor(cursor: string, workspaceId: ObjectId, status: "active" | "archived"): { updatedAt: Date; id: ObjectId } {
    const [payload, signature, extra] = cursor.split(".");
    if (!payload || !signature || extra !== undefined) throw new InvalidProjectCursorError();

    const expected = createHmac("sha256", this.cursorSecret).update(payload).digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(signature, "base64url");
    } catch {
      throw new InvalidProjectCursorError();
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new InvalidProjectCursorError();

    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      throw new InvalidProjectCursorError();
    }
    const parsed = cursorPayloadSchema.safeParse(raw);
    if (!parsed.success || parsed.data.workspaceId !== workspaceId.toHexString() || parsed.data.status !== status) throw new InvalidProjectCursorError();
    return { updatedAt: new Date(parsed.data.updatedAt), id: new ObjectId(parsed.data.id) };
  }
}

export async function provisionPersonalWorkspace(mongo: MongoDatabase, ownerUserId: string): Promise<void> {
  await mongo.connect();
  const workspaces = mongo.database().collection<WorkspaceDocument>("workspaces");
  await workspaces.createIndex({ ownerUserId: 1 }, { unique: true, name: "uniq_personal_workspace_owner" });
  const now = new Date();
  await workspaces.updateOne(
    { ownerUserId },
    { $setOnInsert: { ownerUserId, status: "active", createdAt: now, updatedAt: now } },
    { upsert: true },
  );
}

export class InvalidProjectCursorError extends Error {
  constructor() {
    super("Invalid project cursor.");
    this.name = "InvalidProjectCursorError";
  }
}
