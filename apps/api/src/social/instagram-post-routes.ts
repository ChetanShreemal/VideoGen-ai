import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { ObjectId, type Document } from "mongodb";
import {
  apiErrorResponseSchema,
  createInstagramPostDraftRequestSchema,
  instagramPostDraftParamsSchema,
  instagramPostDraftResponseSchema,
  instagramPostDraftsResponseSchema,
  projectIdParamsSchema,
  updateInstagramPostDraftRequestSchema,
} from "@videogen/contracts";
import type { MongoDatabase } from "@videogen/database";
import type { createAuth } from "../auth.js";
import type { ProjectRepository } from "../projects/project-repository.js";

type PostDocument = Document & {
  _id: ObjectId; ownerUserId: string; workspaceId: ObjectId; projectId: ObjectId; exportId: ObjectId;
  fileName: string; caption: string; status: "draft" | "approved"; revision: number;
  approvedAt?: Date; approvalSnapshot?: string; createdAt: Date; updatedAt: Date;
};

function fail(reply: any, status: number, code: string, message: string) {
  return reply.status(status).send(apiErrorResponseSchema.parse({ error: { code, message } }));
}

function view(item: PostDocument) {
  return { id: item._id.toHexString(), projectId: item.projectId.toHexString(), exportId: item.exportId.toHexString(),
    fileName: item.fileName, caption: item.caption, status: item.status, revision: item.revision,
    approvedAt: item.approvedAt?.toISOString() ?? null, updatedAt: item.updatedAt.toISOString() };
}

export async function registerInstagramPostRoutes(app: FastifyInstance, auth: ReturnType<typeof createAuth>, mongo: MongoDatabase, projects: ProjectRepository) {
  const db = mongo.database();
  const posts = db.collection<PostDocument>("social_posts");
  const exports = db.collection<Document & { _id: ObjectId; ownerUserId: string; projectId: ObjectId; fileName: string; status: string }>("projectExports");
  const accounts = db.collection<Document & { workspaceId: ObjectId; platform: string; expiresAt: Date }>("social_accounts");
  await posts.createIndex({ ownerUserId: 1, projectId: 1, updatedAt: -1 }, { name: "instagram_post_drafts_list" });

  const userFor = async (request: any, reply: any): Promise<string | undefined> => {
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
      if (!session) { fail(reply, 401, "UNAUTHENTICATED", "A valid session is required."); return undefined; }
      return session.user.id;
    } catch { fail(reply, 503, "AUTH_UNAVAILABLE", "Authentication is temporarily unavailable."); return undefined; }
  };

  const resolveExport = async (ownerUserId: string, projectId: ObjectId, exportId: ObjectId) =>
    exports.findOne({ _id: exportId, ownerUserId, projectId, status: "ready" });

  app.get("/api/v1/projects/:projectId/instagram-posts", async (request: any, reply: any) => {
    const ownerUserId = await userFor(request, reply); if (!ownerUserId) return;
    const params = projectIdParamsSchema.safeParse(request.params); if (!params.success) return fail(reply, 400, "VALIDATION_ERROR", "Project ID is invalid.");
    try {
      const projectId = new ObjectId(params.data.projectId);
      const project = await projects.get(ownerUserId, projectId);
      if (!project || project.status !== "active") return fail(reply, 404, "PROJECT_NOT_FOUND", "Active project was not found.");
      const items = await posts.find({ ownerUserId, projectId }).sort({ updatedAt: -1 }).limit(50).toArray();
      return reply.send(instagramPostDraftsResponseSchema.parse({ data: { items: items.map(view) } }));
    } catch { request.log.error("Instagram post drafts could not be listed."); return fail(reply, 503, "INSTAGRAM_POSTS_UNAVAILABLE", "Instagram post drafts are temporarily unavailable."); }
  });

  app.post("/api/v1/projects/:projectId/instagram-posts", async (request: any, reply: any) => {
    const ownerUserId = await userFor(request, reply); if (!ownerUserId) return;
    const params = projectIdParamsSchema.safeParse(request.params); const input = createInstagramPostDraftRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return fail(reply, 400, "VALIDATION_ERROR", "Post draft details are invalid.");
    try {
      const projectId = new ObjectId(params.data.projectId); const project = await projects.get(ownerUserId, projectId);
      if (!project || project.status !== "active") return fail(reply, 404, "PROJECT_NOT_FOUND", "Active project was not found.");
      const exportId = new ObjectId(input.data.exportId); const exportItem = await resolveExport(ownerUserId, projectId, exportId);
      if (!exportItem) return fail(reply, 404, "EXPORT_NOT_FOUND", "Choose a saved export from this project.");
      const now = new Date(); const item: PostDocument = { _id: new ObjectId(), ownerUserId, workspaceId: await projects.ensurePersonalWorkspace(ownerUserId), projectId, exportId,
        fileName: exportItem.fileName, caption: input.data.caption, status: "draft", revision: 1, createdAt: now, updatedAt: now };
      await posts.insertOne(item);
      return reply.status(201).send(instagramPostDraftResponseSchema.parse({ data: { item: view(item) } }));
    } catch { request.log.error("Instagram post draft could not be created."); return fail(reply, 503, "INSTAGRAM_POSTS_UNAVAILABLE", "Instagram post draft could not be created."); }
  });

  app.patch("/api/v1/projects/:projectId/instagram-posts/:postId", async (request: any, reply: any) => {
    const ownerUserId = await userFor(request, reply); if (!ownerUserId) return;
    const params = instagramPostDraftParamsSchema.safeParse(request.params); const input = updateInstagramPostDraftRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return fail(reply, 400, "VALIDATION_ERROR", "Post draft update is invalid.");
    try {
      const projectId = new ObjectId(params.data.projectId); const postId = new ObjectId(params.data.postId); const exportId = new ObjectId(input.data.exportId);
      const project = await projects.get(ownerUserId, projectId);
      if (!project || project.status !== "active") return fail(reply, 404, "PROJECT_NOT_FOUND", "Active project was not found.");
      const exportItem = await resolveExport(ownerUserId, projectId, exportId);
      if (!exportItem) return fail(reply, 404, "EXPORT_NOT_FOUND", "Choose a saved export from this project.");
      const now = new Date();
      const item = await posts.findOneAndUpdate({ _id: postId, ownerUserId, projectId, revision: input.data.expectedRevision }, {
        $set: { exportId, fileName: exportItem.fileName, caption: input.data.caption, status: "draft", updatedAt: now },
        $inc: { revision: 1 }, $unset: { approvedAt: "", approvalSnapshot: "" },
      }, { returnDocument: "after" });
      if (!item) return fail(reply, 409, "STALE_REVISION", "This draft changed elsewhere. Reload it before saving.");
      return reply.send(instagramPostDraftResponseSchema.parse({ data: { item: view(item) } }));
    } catch { request.log.error("Instagram post draft could not be updated."); return fail(reply, 503, "INSTAGRAM_POSTS_UNAVAILABLE", "Instagram post draft could not be updated."); }
  });

  app.post("/api/v1/projects/:projectId/instagram-posts/:postId/approve", async (request: any, reply: any) => {
    const ownerUserId = await userFor(request, reply); if (!ownerUserId) return;
    const params = instagramPostDraftParamsSchema.safeParse(request.params); if (!params.success) return fail(reply, 400, "VALIDATION_ERROR", "Post ID is invalid.");
    try {
      const projectId = new ObjectId(params.data.projectId); const postId = new ObjectId(params.data.postId);
      const project = await projects.get(ownerUserId, projectId);
      if (!project || project.status !== "active") return fail(reply, 404, "PROJECT_NOT_FOUND", "Active project was not found.");
      const workspaceId = await projects.ensurePersonalWorkspace(ownerUserId);
      if (!await accounts.findOne({ workspaceId, platform: "instagram", expiresAt: { $gt: new Date() } })) return fail(reply, 409, "INSTAGRAM_NOT_CONNECTED", "Connect a professional Instagram account before approving this post.");
      const item = await posts.findOne({ _id: postId, ownerUserId, projectId });
      if (!item) return fail(reply, 404, "INSTAGRAM_POST_NOT_FOUND", "Post draft was not found.");
      if (item.status === "approved") return reply.send(instagramPostDraftResponseSchema.parse({ data: { item: view(item) } }));
      if (!await resolveExport(ownerUserId, projectId, item.exportId)) return fail(reply, 409, "EXPORT_NOT_AVAILABLE", "The selected video is no longer available. Choose another export.");
      const now = new Date(); const approvalSnapshot = `${item.exportId.toHexString()}\n${item.caption}`;
      const approved = await posts.findOneAndUpdate({ _id: postId, ownerUserId, projectId, revision: item.revision, status: "draft" }, {
        $set: { status: "approved", approvedAt: now, approvalSnapshot, updatedAt: now }, $inc: { revision: 1 },
      }, { returnDocument: "after" });
      if (!approved) return fail(reply, 409, "STALE_REVISION", "This draft changed elsewhere. Reload it before approving.");
      return reply.send(instagramPostDraftResponseSchema.parse({ data: { item: view(approved) } }));
    } catch { request.log.error("Instagram post draft could not be approved."); return fail(reply, 503, "INSTAGRAM_POSTS_UNAVAILABLE", "Instagram post could not be approved."); }
  });
}
