# AI VideoGen — Lovable Prototype Prompt

> **Purpose:** Build a coherent, clickable, end-to-end V1 product prototype in Lovable from the approved product direction in `PRD.md`, `SYSTEM_DESIGN.md`, and `API_DESIGN.md`.
>
> **Status:** Ready for the first Lovable prototype attempt, following the user's direction to try Lovable.
>
> **Prototype boundary:** Build the frontend experience with local/mock data and realistic state transitions. Do not create a production backend, call real AI providers, connect real social accounts, publish posts, or expose secrets. Keep API integration replaceable and consistent with the supplied API design.

## Product to build

Create **AI VideoGen**, a desktop-first responsive web application for individual creators to turn an idea into a downloadable AI-generated video. V1 supports Cartoon and Educational video projects, a guided workflow, editable script/storyboards and scenes, generation progress, preview, export, and optional Instagram publishing after explicit review and approval.

The product should work well for a first-time creator without prompt-engineering or editing expertise. The default path is a guided wizard, with advanced controls revealed only when needed. The result should feel like a polished creative tool: modern, minimal, distinctive, professional, and quietly futuristic. This is a product application, not a marketing landing page.

## Visual direction

Use **NamasteDev.com** as a visual reference for its dark, high-contrast presentation, warm orange emphasis, and subtle technical-grid details. Adapt those cues to a video-creation studio; do not copy its logo, content, or exact layouts.

- **Font:** Roboto throughout: headings, navigation, controls, forms, cards, and body copy. Use size and weight for hierarchy; do not add a second display typeface.
- **Dark theme:** near-black `#08090B` and charcoal `#15171B` surfaces; warm-white `#F5F5F2` primary text; muted gray secondary text; orange `#F28C28` for primary actions, active progress, and selected highlights.
- **Light theme:** soft white `#FAFAF8`, light neutral-gray panels, near-black text, subtle gray dividers, and the same orange accent.
- Provide a working light/dark theme toggle and preserve contrast and hierarchy in both themes. Start in dark theme.
- Use a subtle low-contrast grid only in selected background/hero areas, not behind dense form or editing controls.
- Use cinematic video thumbnails and a consistent sample project; no robot imagery, purple-blue gradient wash, decorative AI sparkles, glowing orbs, or excessive glassmorphism.
- Use restrained corner radii, clear spacing, thin dividers, and restrained motion. Respect reduced-motion preferences.
- Keep copy direct and human: “Build your story,” “Review your scenes,” “Generate video,” “Download video.”

## Core V1 constraints

- One creator account per user. No team workspace, collaboration, meetings, or organization switching.
- Main creative path: **Create video → Idea → Script/storyboard → Generate → Review → Download or Publish**.
- Genres: Cartoon and Educational.
- Duration candidates: 30, 60, and 90 seconds. Aspect-ratio candidates: 9:16, 16:9, and 1:1. Treat the presets as configurable/provisional because the source docs leave exact presets open.
- English, Hindi, and major Indian voiceover languages are candidates; exact options remain configurable/provisional.
- Support optional reference image/video upload and recurring-character descriptions/references in the UI.
- Allow creator edits to script, scene visuals, narration, and captions at scene level. Use ordered scene cards and a contextual inspector, not a general-purpose timeline editor.
- After generation, allow only supported scene-level defect repair/regeneration; do not build freeform clip trimming, a multi-track editor, or unrestricted post-generation video editing.
- Show usage history, but no billing, subscriptions, or credit purchase in V1.
- Instagram is the only V1 publishing destination. Show one connected account, **Publish now** only, and require explicit manual review/approval for the exact render, account, caption, and hashtags. Never publish automatically.
- Do not invent final codec, FPS, export resolution, watermark, pricing, API endpoints, or authentication-provider behavior. Represent unresolved options with configurable UI controls and placeholders.

## Routes and connected screens

Build a consistent app shell for authenticated screens with a compact left navigation: Projects, Create video, Media library, Usage, and Settings. Include the product wordmark, account menu, and theme toggle. Ensure every flow can be navigated end to end and has back/cancel routes.

### Public entry

1. **Sign in** — product mark, concise value statement, email/password form if password auth is selected, show/hide password, sign-in action, forgot-password route, and create-account link. Keep auth provider selection replaceable; Google sign-in may be shown as an optional variant, not a fixed requirement.
2. **Create account** — public sign-up form with validation and a return-to-sign-in path.
3. **Recovery / confirmation states** — password recovery/reset or email confirmation only as configurable auth-provider variants; do not force email verification as a product rule. Include expired session/link, invalid credentials, provider error, rate limit, submitting, and network-error states. Avoid revealing whether an account exists.

### Projects dashboard

- Returning-user view with filters/tabs for Drafts, In progress, Completed, and Failed.
- Project cards show title, thumbnail, Cartoon/Educational style, target duration, updated time, and clear status.
- Actions to create, open/resume, rename, duplicate, and archive where appropriate.
- First-use empty state with a direct **Create video** action and one concise example idea.
- Resuming a draft returns to its latest saved pre-generation step. Running work shows its current stage.

### Create video wizard

Build a step-by-step flow with progress, back navigation, saved state, and a persistent next action:

1. **Choose a format:** Cartoon or Educational; candidate duration and aspect-ratio controls; language/voice where available.
2. **Describe the idea:** idea textarea, concise example, optional audience/tone/objective, and **Brainstorm ideas** action.
3. **Choose an idea:** several distinct suggestions with select, edit, and regenerate actions. Preserve the original prompt.
4. **Review creative plan:** script and storyboard review before generation; edit whole script or a scene; approve the plan.
5. **Add references (optional):** upload image/video references and define recurring characters. Show file validation, progress, and failure states.
6. **Review generation and cost:** summarize selected options and any available cost estimate. Clearly explain that estimates are not final invoices. Require explicit approval before a potentially paid generation/render operation; do not show billing plans.

### Script and storyboard workspace

- Use ordered scene cards with scene number, estimated duration, visual preview/placeholder, narration excerpt, and caption/on-screen text.
- A scene inspector lets the creator edit visual description/image prompt, narration, and captions; optionally edit/regenerate one scene without changing others.
- Support add/remove/reorder where available, clear duration totals, and warnings when the script likely exceeds the target.
- Show recurring-character references and consistency guidance.
- Show revision/approval state. Approved revisions are read-only; editing creates a new draft revision.
- If an edit makes generated downstream assets stale, label that clearly and offer the relevant next step.
- Educational factual content should be labeled as AI-generated and needing creator review.

### Generation progress

- Show a generation workspace with selected project settings and a clear project status.
- Represent stages such as storyboard, scene images, narration, asset upload, rendering, and output verification, with per-stage/per-scene states where applicable.
- Include queued, running, partial failure, failed, cancel requested, cancelled, completed, and retry states.
- Preserve successful scenes on partial failure; identify the failed stage and offer a targeted retry.
- Treat progress percentage as advisory. Show completion only after output verification.
- Cancellation should communicate that already incurred provider costs may not be reversible.

### Review and scene repair

- Show a large playable video preview with audio, captions, correct aspect ratio, and visible controls.
- Distinguish preview-ready from final-render-ready.
- Allow limited scene-level defect repair/regeneration when eligible, showing which scene will be affected and what will be preserved.
- Keep previous successful exports available. Do not overwrite prior versions silently.
- No timeline, trim/split/clip-edit tools, or general post-generation editor.

### Export

- Focused export panel with chosen format and configurable available quality options; leave unresolved codec/FPS/resolution/watermark values clearly provisional.
- Show render/export progress, verification, completion, and actionable failure/retry states.
- Success provides **Download video**, **Back to project**, and a concise summary. Keep export history visible in the project/media library.

### Instagram connection and publishing

- Settings screen can connect one Instagram account through an OAuth handoff placeholder. Never ask for the Instagram password inside the app.
- Show connected, disconnected, expired/reconnect, denied, and ineligible-account states. Do not implement real OAuth in this prototype.
- From an export-ready project, open a publish review screen showing the exact video preview, selected account, editable caption, suggested hashtags, and compatibility checks.
- Require an explicit approval/confirmation action for the exact render, account, and content before **Publish now**.
- Mock statuses: draft, approved, publishing, published, failed, and outcome unknown/reconciliation required. On success show a sample post link; on uncertain result show a status-check action, not a blind republish.
- Do not include scheduled publishing, auto-posting, analytics, or other platforms.

### Media library and usage

- Organize uploaded references, generated assets, previews, and exported videos with type, project, date, and preview/download affordances.
- Warn before deleting an asset used by a project; mock deletion safely.
- Usage page lists generation/render activity and status without billing totals, plan limits, or credit purchase.

### Settings

- Account basics, light/dark theme preference, and Instagram connection state.
- Do not invent account deletion, data-retention rules, billing, or team settings; keep unresolved settings clearly out of the primary flow.

## Prototype interactions

Make the prototype feel real with local state and mock data:

- Buttons and navigation work; wizard steps advance/back; forms validate; idea cards select; script and scene fields edit; scene reorder or add/remove work if included.
- Mock generation progresses through stages and can demonstrate success, partial failure, retry, and cancellation without real provider calls.
- Preview, export download, social connection, and publishing are safe demos. Do not transmit user content to real services or publish externally.
- Theme toggle changes all product screens, not just the current page.
- Use realistic sample projects and video thumbnails, such as an educational water-cycle video and a short cartoon story.
- Keep prototype data local and disposable; do not request real credentials.

## Quality bar

- Every required screen is reachable through the app; no disconnected mockups or dead-end CTAs.
- Keep visual tokens, navigation, status labels, and controls consistent across routes and themes.
- The first-time flow is understandable without a tutorial.
- Scene-level creative planning remains distinct from generated-video review; the design does not accidentally become a generic video timeline editor.
- Instagram publication requires a separate review and explicit approval, never an automatic action.
- Responsive desktop, tablet, and mobile layouts are deliberate. On mobile, stack the wizard, use compact scene cards, and open the scene inspector in a full-screen panel or bottom sheet.
- Meet accessible contrast and keyboard navigation expectations; never communicate status by color alone.

## Deliverable

Implement a polished clickable frontend prototype with all routes/states above and mock interactions. Keep the code organized so a later implementation can replace mock actions with the API defined in `API_DESIGN.md`, while following ownership, idempotency, cost-approval, revision, and explicit-publish rules. Do not modify or contradict the product scope in the three source documents.
