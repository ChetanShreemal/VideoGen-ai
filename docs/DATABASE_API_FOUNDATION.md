# MongoDB and API Foundation — Design Proposal

**Status:** Foundation implementation in progress; initial shared project Zod contracts and OpenAPI 3.1 create/list documentation are implemented, but API handlers and project persistence are not
**Scope:** Phase A database/API foundation and the first persistent feature slice
**Sources:** `PRD.md`, `SYSTEM_DESIGN.md`, and `API_DESIGN.md` review drafts in `C:\Users\Chetan\Downloads`, read 2026-11-02.

## 1. Goal and implementation order

Establish a safe, testable MongoDB boundary before adding generation or media providers. The first persistent feature is **Projects**: create, list, read, update, archive, and restore an authenticated user's own projects.

1. Configure the development Atlas cluster using the root `.env` file, excluded by `.gitignore`; keep the connection string out of source control.
2. Add a shared MongoDB package with one managed client per process and graceful shutdown. **Implemented; type-check passed.**
3. Add database readiness to the API health surface; keep liveness independent of MongoDB. **Implemented; Atlas readiness returned 200 on 2026-11-03.**
4. Add project contracts, repository, service, and REST handlers with workspace-scoped authorization. **Initial request/response Zod contracts, personal workspace provisioning, repository, and authenticated create/list routes are implemented; broader CRUD remains.**
5. Add the project API contract to OpenAPI and the test register; verify isolation and persistence against a local MongoDB replica set or Atlas test database.

The local Atlas URI is excluded from Git. No production credentials, paid integrations, or production migration are part of this slice.

## 2. Decisions from the source documents

| Area | Foundation proposal | Basis / status |
|---|---|---|
| Database | MongoDB Atlas in deployed environments; local MongoDB replica set for development and integration tests | Confirmed preferred technology in PRD; deployment details remain to be configured |
| Current development database | User-provided Atlas cluster, database name `videogen_dev`; URI is in ignored local `.env` only | Configured locally; SRV DNS lookup returned `ECONNREFUSED`, so the database was not reached |
| API | Fastify modular monolith, TypeScript, `/api/v1`, Zod boundary validation | Current scaffold and API/System Design proposals |
| Identity boundary | One private personal workspace per registered user in V1. Derive `workspaceId` from the authenticated server session; never accept it as authorization from request data. | PRD §13.1 |
| Database IDs | MongoDB `ObjectId` internally, serialized as opaque hex strings at the API edge | Consistent with API draft; avoids mixed ID conventions |
| Media | Store metadata and private object keys only; media bytes remain in private R2 | System/API Design |
| Project deletion | Archive with `archivedAt`; preserve records and related media pending an approved retention/deletion policy | API draft says soft archive; retention duration remains open |
| Storyboards | Separate version documents; embed ordered scenes in each immutable version. Edits create a draft revision. | System Design |
| Authentication | Better Auth is preferred/approved at technology level, but exact methods, adapter/session configuration, and routes remain open. Do not invent auth routes or credentials. | PRD/System Design |

## 3. Data model

Every application document has `createdAt` and `updatedAt` where appropriate. Workspace-owned records include `workspaceId`; user-authored records also include `createdBy`. These fields are assigned by trusted server code. Database documents do not embed large media, raw provider responses, secrets, or unbounded histories.

| Collection | Purpose and key fields | Initial index proposal |
|---|---|---|
| Auth adapter collections | Better Auth-owned users, sessions, accounts, verification, and any adapter-required records. Follow the selected adapter's exact schema. | Create via adapter; do not hand-roll password/session storage. |
| `workspaces` | `_id`, `ownerUserId`, `status`, timestamps; one personal workspace per user in V1. | Unique `{ ownerUserId: 1 }`. Make signup creation idempotent. |
| `projects` | `_id`, `workspaceId`, `createdBy`, `title`, `topic`, `settings`, `status`, `revision`, `latestStoryboardId?`, `latestRenderId?`, `archivedAt?`, timestamps. | `{ workspaceId: 1, status: 1, updatedAt: -1, _id: -1 }`; optional partial unique indexes only after a product rule needs them. |
| `storyboards` | `_id`, `workspaceId`, `projectId`, `version`, `status`, `revision`, ordered `scenes[]`, generation metadata, `createdBy`, timestamps. | Unique `{ workspaceId: 1, projectId: 1, version: 1 }`; `{ workspaceId: 1, projectId: 1, createdAt: -1 }`. |
| `assets` | `_id`, `workspaceId`, `projectId`, optional `storyboardId`/`sceneId`, type, private `objectKey`, MIME type, byte count, checksum, media metadata, generation fingerprint, status, timestamps. | `{ workspaceId: 1, projectId: 1, createdAt: -1, _id: -1 }`; deduplication index design awaits fingerprint scope/retention rules. |
| `generation_jobs` | `_id`, `workspaceId`, `projectId`, optional storyboard, type, status, stage, progress, attempt, idempotency reference, input/result references, safe error code, worker lease/heartbeat, timestamps. | `{ workspaceId: 1, createdAt: -1, _id: -1 }`; `{ status: 1, updatedAt: 1 }`; unique idempotency scope defined in §5. |
| `renders` | `_id`, `workspaceId`, `projectId`, storyboard/job refs, immutable manifest version, adapter refs, status, output asset ref, verified media metadata, timestamps. | `{ workspaceId: 1, projectId: 1, createdAt: -1 }`; unique adapter job ref where present. |
| `social_accounts` | `_id`, `workspaceId`, platform, platform account ID, display metadata, credential reference, scopes, expiry and health; no plaintext access token. | Unique `{ workspaceId: 1, platform: 1 }` for the PRD one-account rule; reconnection policy remains open. |
| `social_posts` / `publish_attempts` | Workspace/project/render/account refs, caption, explicit approval snapshot, publish state, external IDs, attempt/reconciliation records. | `{ workspaceId: 1, createdAt: -1 }`; unique idempotency scope for publish requests. |
| `usage_events` / `audit_events` | Append-oriented provider usage and security-relevant actions; redact sensitive content. | `{ workspaceId: 1, timestamp: -1 }`; retention/TTL is not set until policy is approved. |
| `idempotency_records` | Request key scope, request fingerprint, response/job ref, status, expiry. Store no secrets or raw request bodies. | Unique `{ workspaceId: 1, operation: 1, key: 1 }`; TTL on `expiresAt` after retention is decided. |

### Ownership and references

- Resolve the authenticated user to the personal workspace on the server; each project query includes both `_id` and `workspaceId`.
- A nested resource lookup must include `workspaceId` and its parent ID; never trust a client-supplied workspace ID or a globally unique ObjectId alone.
- Return the same `404 NOT_FOUND` shape for missing and inaccessible project resources to avoid resource enumeration.
- Index every foreign-key-like reference used in list, cleanup, or worker reconciliation paths. MongoDB does not enforce relational foreign keys; service invariants and integration tests must cover them.
- Use transactions only for multi-document invariants that require atomicity (for example, workspace creation plus initial account state). Require a replica-set deployment locally and in Atlas. Prefer a single-document atomic update where possible.

## 4. First project API contract

All routes require an authenticated session. API response envelope follows the API draft: `{ data, meta? }`; errors use `{ error: { code, message, requestId, details? } }`. `workspaceId` and `createdBy` are never writable request fields.

The shared `@videogen/contracts` package defines strict Zod schemas for project settings, create requests, project responses, create responses, and paginated list responses. [`openapi.yaml`](openapi.yaml) documents the initial create/list endpoints and these response envelopes. The schemas are the source for both API and web types. Settings fields have primitive validation, but their allowed value sets remain intentionally open pending reconciliation of the PRD and System Design notes. Runtime contract cases are recorded as T-040 and T-041 and have not yet been run.

| Method and route | Contract |
|---|---|
| `POST /api/v1/projects` | Validate `{ title, topic?, settings? }`; derive workspace/user; return `201` and the created project. Do not enqueue paid work. |
| `GET /api/v1/projects?limit=&cursor=` | List active projects for the session workspace, newest updated first with `_id` tie-breaker. Default `limit=20`, max `100`; return `{ items, nextCursor }`. |
| `GET /api/v1/projects/:projectId` | Return one active project scoped to the session workspace. |
| `PATCH /api/v1/projects/:projectId` | Accept only editable fields. Require `If-Match` revision; atomically update if the revision matches, increment revision, otherwise `409 STALE_REVISION`. |
| `DELETE /api/v1/projects/:projectId` | Soft archive by setting `archivedAt` and status; return `204`. Repeating the request is safe. Physical cleanup is a separate retention workflow. |
| `POST /api/v1/projects/:projectId/restore` | Restore an archived project owned by this workspace; return `200`. This explicit route is proposed to support the PRD resume/archive lifecycle. |

Project response fields: `id`, `title`, `topic?`, `settings`, `status`, `revision`, `createdAt`, `updatedAt`, and optional storyboard/render summary references. Never return internal credentials, raw database documents, or private R2 keys. For project list cards, include summaries only; fetch detailed storyboard/asset data from their own authorized routes.

## 5. API and persistence invariants

- Validate request, persisted domain object, and API response with shared Zod schemas; strip/reject server-managed fields from writes.
- Use stable `X-Request-Id` values for logs and error responses; logs must redact session cookies, tokens, credentials, and raw uploaded content.
- Use `If-Match`/revision on editable project records. A successful update is a conditional single-document update, not read-then-write.
- Use `Idempotency-Key` for generation, rendering, and publishing commands. Scope by workspace, operation and key; bind to a canonical request fingerprint. Same key and same request returns the original job/result; same key with a different request returns `409 IDEMPOTENCY_CONFLICT`.
- Use cursor pagination with a signed/opaque cursor tied to the sort version and workspace. Do not accept raw Mongo query/sort/filter objects from clients.
- Separate liveness from readiness: `GET /api/v1/health` confirms the process responds; `GET /api/v1/ready` reports unavailable until configuration and MongoDB ping succeed. Do not expose URI, host, database name, or driver error details.
- Build indexes idempotently at startup or via a versioned index task. Startup fails clearly if required indexes cannot be established; production rollout should use an explicit migration/index step before traffic when index changes become operationally significant.

## 6. Open decisions before implementation

1. Better Auth MongoDB sessions are implemented; email verification remains disabled pending the product policy decision. Project routes require its session and derive workspace ownership server-side.
2. Local development uses the supplied Atlas cluster. Decide whether to add a Docker replica-set fallback; do not commit real connection strings.
3. Reconcile the spec header's “duration/aspect ratios open” note with the body decisions for 30/60/90 seconds and 9:16, 16:9, 1:1 before freezing `settings` enums.
4. Decide project archive/resume semantics, hard-delete/data-export policy, and retention periods before TTL indexes or cleanup workers are introduced.
5. Set idempotency retention, usage/audit retention, and job progress detail limits before TTL indexes or unbounded history are introduced.
6. Liveness remains available independently of MongoDB; readiness reports unavailable on database failure.
7. The Windows DNS SRV lookup issue was resolved for the current environment with `MONGODB_DNS_SERVERS`; API readiness returned 200 with Atlas connected. Recheck if the network/environment changes.

## 7. Acceptance and verification plan

These acceptance cases are tracked separately from their results. The first create/list integration and cursor-isolation cases have been run against Atlas; see T-040–T-043 in `PROJECT_STATUS.md`. Remaining CRUD and database bootstrap cases are not yet verified.

| ID | Case | Expected result |
|---|---|---|
| DB-01 | Start API with missing or malformed MongoDB URI | Startup/configuration fails safely; no secret is logged. |
| DB-02 | MongoDB unavailable after API starts | Liveness stays available; readiness returns unavailable without connection details. |
| DB-03 | Bootstrap indexes twice | Succeeds both times; no duplicate or destructive index changes. |
| PRJ-01 | Unauthenticated create/list/read/update/archive | Each protected operation returns `401 UNAUTHENTICATED`. |
| PRJ-02 | Workspace A reads/updates/archives Workspace B project by ID | Same `404 NOT_FOUND` as missing resource; no data changes. |
| PRJ-03 | Create project with unknown/server-managed fields | Invalid input rejected; caller cannot set `workspaceId`, `createdBy`, IDs, revision or lifecycle timestamps. |
| PRJ-04 | Update using current and stale `If-Match` revisions | Current revision succeeds and increments once; stale revision returns `409` without overwriting newer data. |
| PRJ-05 | Paginate projects with equal `updatedAt` timestamps | No duplicates or omissions due to stable `_id` tie-breaker; results remain workspace-scoped. |
| PRJ-06 | Archive and restore a project | Archived project disappears from active list and normal reads; restore returns it without altering its owner or history. |
| PRJ-07 | Repeat archive request | Safe idempotent result; no duplicate cleanup action. |
| JOB-01 | Repeat an async command with same key and same body, then same key with a different body | First retry reuses original job; changed payload returns `409 IDEMPOTENCY_CONFLICT`. |

Next implementation slice: add read/update/archive/restore routes and the project UI after create/list persistence and ownership are verified against Atlas.
