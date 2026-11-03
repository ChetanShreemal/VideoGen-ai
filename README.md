# AI VideoGen

AI VideoGen is being built in small, reviewable increments. The repository includes a web/API foundation and the first email/password authentication slice. See `PROJECT_STATUS.md` for implementation, test, and decision status.

## Current scaffold

- `apps/web` — Next.js App Router application (TypeScript).
- `apps/api` — Node.js TypeScript REST API using Fastify; MongoDB-backed Better Auth sessions, health/readiness, and Resend password-reset integration.
- `packages/contracts` — shared Zod contracts for API boundaries.
- `PROJECT_STATUS.md` — project plan, implementation status, test cases, results, open decisions, and session log.

## Requirements

- Node.js 20.9 or newer.
- npm with workspace support.

## Start locally

Install dependencies from the repository root:

```powershell
npm install
```

In separate terminals, run the web app and API:

```powershell
npm run dev:web
```

```powershell
npm run dev:api
```

The web app starts at `http://localhost:3000`. The API health endpoint is `http://127.0.0.1:4000/api/v1/health`.

To deliver password reset messages, configure `RESEND_API_KEY` and `AUTH_EMAIL_FROM` in the ignored root `.env` file. The sender address must be permitted by your Resend account; the example uses Resend's onboarding sender for initial development.

Build and type-check commands are available at the root:

```powershell
npm run build
npm run typecheck
```

## Stepwise implementation plan

Each step should have a narrow scope, acceptance criteria, and recorded verification in `PROJECT_STATUS.md` before starting the next feature.

1. **Foundation:** monorepo, web shell, API process, shared contracts, and MongoDB readiness.
2. **Authentication (in progress):** email/password sign-up/sign-in and sessions are implemented; password recovery is wired to Resend; configure credentials and verify email delivery, then decide email verification policy.
3. **Projects:** private ownership, project create/list/open/update/archive flows and persistence.
4. **Idea and storyboard:** validated contracts, generation provider decision, editable versions, approval.
5. **Assets and audio:** uploads, storage adapter, voice/music controls, async job status.
6. **Generation and recovery:** provider adapters, per-scene progress, retry/cancel, idempotency.
7. **Preview and export:** Remotion integration, render verification, durable storage, download.
8. **Instagram:** official authorization, account lifecycle, review, explicit publish approval, reconciliation.
9. **Hardening:** security, quotas, observability, backup/recovery, deployment and release checks.

## Git workflow

Push completed project changes to the `origin` remote after committing them. Keep commits focused, never force-push, and do not commit credentials, local environment files, dependency folders, or build output.

## Decisions deliberately deferred

Resend delivery requires a private API key and permitted sender configuration. Google OAuth, email verification policy, background orchestration, visual-generation provider, AI credentials, object storage, cloud rendering, and Meta publishing remain open or unconfigured. See `PROJECT_STATUS.md` and the review drafts in `C:\Users\Chetan\Downloads`.
