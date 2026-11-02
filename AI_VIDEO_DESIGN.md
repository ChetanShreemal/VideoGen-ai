# AI VideoGen — Stitch Design Brief

> **Status:** Draft for product review. This brief is aligned to `PRD.md`, `SYSTEM_DESIGN.md`, and `API_DESIGN.md` (22 October 2026). It has not been submitted to Google Stitch.
>
> **Product scope:** Individual creators in V1. The product guides a creator from an idea to a reviewed, downloadable AI-generated video, with optional Instagram publishing after explicit user approval. Stitch is used to design the product experience; it is not part of the runtime system.
>
> **Decision handling:** Where the source documents label a decision open or unresolved, show the UI in a way that can accommodate alternatives. Treat example presets in this brief as provisional. Do not invent auth-provider routes, vendor behavior, prices, or implementation details.

## Design goal

Create a complete, connected, desktop-first responsive web product for beginner-friendly AI video creation. The default experience is a guided wizard; advanced controls are available when requested. Keep the interface modern, minimal, distinctive, professional, and quietly futuristic. Make each step understandable without prompt-engineering or editing expertise.

Avoid generic AI-product styling: no purple-blue gradient wash, glowing orbs, robot imagery, decorative sparkles, excessive glassmorphism, or arbitrary metric dashboards. Let strong typography, editorial composition, carefully chosen video stills, and clear stage/progress design create the visual identity. The generated work should remain the main visual focus.

## Proposed brand direction: Signal / Studio — NamasteDev visual reference

A working proposal. Use NamasteDev.com as a visual reference for its dark, high-contrast presentation, warm orange emphasis, subtle technical grid, and energetic but clear calls to action. Adapt those cues to a focused video-creation studio; do not copy its logo, page content, or exact compositions.

- **Character:** confident, practical, creative, precise, human; professional enough for a production workflow.
- **Dark theme (primary reference):** near-black `#08090B` and charcoal `#15171B` surfaces, warm white `#F5F5F2` text, muted gray secondary text, and vivid orange `#F28C28` for primary actions and important highlights. Use a subtle low-contrast grid only in selected high-level surfaces, never behind dense editor controls.
- **Light theme:** soft white `#FAFAF8` and light neutral-gray surfaces, near-black text, subdued gray dividers, and the same orange accent. Preserve hierarchy and contrast when the theme inverts; do not make the light theme a separate visual identity.
- **Accent use:** orange is the main interactive accent, applied sparingly to primary buttons, active progress, and selected highlights. Keep secondary accent colors rare; avoid the former cobalt/lilac palette and avoid neon glow effects.
- **Theme control:** both light and dark themes are in V1. Include a clear theme preference in the account menu/settings and make all key screens work in both themes.
- **Typography:** use **Roboto** throughout the product for headings, body copy, forms, navigation, and controls. Use weight and size for hierarchy rather than switching to a display typeface. Use tabular numerals for durations, counts, and progress values where available.
- **Shape and layout:** disciplined grid, confident whitespace, mostly crisp corners, restrained radii, fine neutral dividers, clear hierarchy. Subtle technical grid motifs may reference NamasteDev, but keep the editor canvas clean.
- **Imagery:** art-directed cartoon and educational video stills; use coherent recurring characters in sample projects. Avoid abstract AI stock visuals.
- **Voice:** direct, warm, assured, craft-oriented. Prefer “Build your story,” “Review your scenes,” and “Generate video” over AI hype.
- **Motion:** purposeful transitions for progress, selection, and playback; respect reduced-motion settings.

## Product principles from the source documents

- **Guided path:** New Video → Idea → Creative Plan (script and storyboard) → Generate → Review → Download or Publish.
- **Few steps by default:** script, storyboard, voice, and scene controls expand on demand.
- **Editable before generation:** the creator can review and edit the script and storyboard, including scene-level script, images, narration, and captions.
- **Scene-level repair:** allow a user to fix/regenerate an eligible scene after generation while preserving unaffected work. Do not design a general-purpose post-generation timeline editor.
- **Recoverable work:** preserve intermediate project data and successful scene assets; make retry and failure states clear.
- **Honest progress:** distinguish drafting, queued, generating by stage/scene, partial failure, preview-ready, render/export-ready, publish-in-progress, published, and failed. Progress percentages are advisory until output verification completes.
- **Cost awareness:** show an estimate and get explicit approval before operations that may incur provider/render cost; track usage, but do not design V1 customer billing or credits.
- **Publishing control:** generation completion never triggers Instagram publication. The user reviews and explicitly approves the specific render, connected account, caption, and hashtags before Publish Now.

## Information architecture

Keep navigation compact and individual-creator oriented:

- **Projects** — drafts, in-progress work, completed projects, and failed jobs.
- **Create video** — guided flow for genre, duration/format, idea, and creative plan.
- **Media library** — uploaded references, generated assets, and exported videos.
- **Usage** — simple usage history/records; no billing dashboard or subscriptions in V1.
- **Settings** — profile, theme, and the single Instagram connection for the user/workspace.

Do not include team workspaces, Brand Kit, Content Calendar, meetings, other social destinations, analytics, scheduled posting, or a general timeline editor in V1.

## End-to-end screens and states

### 1. Authentication and entry

Public sign-up is in scope. The authentication provider and login methods (email, Google, or both) remain open in the PRD/API design. Design provider-neutral form states and show a Google sign-in option only as a clearly replaceable variant; do not assume a particular auth library or route.

Include:

- Sign-in and create-account screens, with accessible email/password fields if password auth is selected.
- Forgot-password and reset-password states only for an auth method that supports them.
- Verification/confirmation state only if required by the selected auth provider; mark this as configurable, not a product-mandated flow.
- Helpful invalid-credentials, expired-session, provider-error, rate-limit, loading, and network-error states. Do not reveal whether an account exists in recovery flows.
- Session-expired handling that returns the user to sign-in without silently losing saved project work.

Keep authentication calm and product-focused. A desktop split layout may pair the form with a tasteful sample video still; on mobile use a compact single-column form. Avoid generic stock-photo sign-in pages, mandatory role quizzes, and unsupported legal/billing screens.

### 2. Projects dashboard

Design a desktop-first home screen for one creator, with a compact navigation rail and clear main canvas.

- Main action: **Create video**.
- Project filters or tabs for Drafts, In progress, Completed, and Failed (or equally clear equivalents).
- Cards include title, thumbnail when available, Cartoon/Educational style, target duration, updated time, and current status.
- Clear resume behavior: opening a draft returns to the last saved pre-generation step; a running project shows its current stage.
- Include a first-use empty state with a direct route into the guided wizard.
- Support rename, duplicate, archive, and resume actions where suitable; present archive/delete safely. No arbitrary dashboard metrics.

### 3. New video — setup wizard

Create a short sequence with a visible step indicator and a useful **Back** action. Keep the guided path simple, with advanced options collapsed until requested.

- Choose one of the V1 genres: **Cartoon** or **Educational**.
- Choose target duration and aspect ratio. The PRD lists 30/60/90 seconds and 9:16/16:9/1:1 as candidate values, but also flags these presets as open decisions; present them as easy-to-adjust proposed controls, not immutable constraints.
- Choose language/voice where supported. English, Hindi, and major Indian voiceover languages are expected candidates; exact supported languages remain open.
- Enter a video idea or choose **Brainstorm ideas**. Optional topic, audience, tone, and objective controls may be tucked into an advanced section.
- Validate required fields, offer concise examples, and keep user-authored idea text visible and editable.
- Before any paid generation/render step, show the current cost estimate, its limitations/expiry if available, the operation it covers, and an explicit approval action. Do not show subscriptions, credit packs, or checkout flows.

### 4. Idea Studio

- Present several meaningfully different AI ideas based on the user’s optional topic, audience, tone, genre, and objective.
- Let the creator select, edit, save, or regenerate suggestions; preserve the original idea and chosen revision.
- Show provider/safety errors as recoverable, actionable states without losing the prompt.
- Do not imply AI factual claims are verified.

### 5. Script and storyboard review

Make this the central creative planning experience before generation. Use ordered scene cards, not a timeline editor.

- Generate a structured script with a hook, scene-by-scene narration, on-screen text/captions, and a closing/CTA when appropriate.
- Show storyboard scenes with visual description, narration reference, estimated duration, caption/on-screen text, transition, and recurring-character references.
- Let the creator edit whole script or individual scenes, regenerate selected scene text/concepts, and add/remove/reorder scenes where supported.
- Provide per-scene image, narration, and caption editing controls in a clear inspector/drawer; make changes explicit and preserve unrelated approved work.
- Support optional reference image/video upload and recurring-character descriptions/references, with concise consistency guidance.
- Show script narration-time estimate and warn if it appears to exceed the chosen target duration. Show scene duration total and flag mismatches.
- Mark approved storyboards as read-only; edits create a new revision. Indicate when a script change makes downstream images, narration, or captions potentially out of date.
- For educational videos, state that generated factual content needs creator review and may flag uncertain claims.
- Include upload progress, unsupported/unsafe media, missing preview, and recoverable provider-failure states.

### 6. Generation progress

Represent the actual staged workflow in a calm, useful way. Show overall progress and per-scene/stage status, such as storyboard, images, narration, asset upload, render, and verification, as applicable.

- States include queued, preparing, generating, rendering, uploading, completed, failed, cancel requested, and cancelled.
- Preserve successful scenes when another scene/audio stage fails; identify what failed and offer a targeted retry.
- Keep cancellation and retry actions visible when available. Do not imply cancellation reverses costs already incurred.
- Treat percentage as indicative and use a clear final verification/completion state.
- Never auto-publish after rendering.

### 7. Preview, review, and scene repair

- Present a playable preview with correct aspect ratio, voiceover, captions, music, and clear preview-vs-final quality labeling.
- Allow limited defect repair/regeneration for eligible scenes. Explain which scene or asset will be regenerated and what approved work will be preserved.
- Keep prior successful exports accessible; do not silently overwrite versions.
- No general-purpose timeline, clip trimming, freeform post-generation editing, or unrestricted voice/caption/video changes after final generation. Ordinary creative edits happen in script/storyboard review; specifically supported scene-level editing remains available per the confirmed V1 design note.

### 8. Export and download

- Offer a focused export panel with the chosen aspect ratio and available resolution/quality settings. Codec, FPS, watermark, and quality tiers are unresolved; do not present invented specifications as final.
- Explain preview-ready vs final-render-ready status.
- Show an honest render/export job state, retry path, and a completion confirmation.
- Provide **Download video**, **Back to project**, and a concise output summary. Keep prior successful exports in the project/media library.
- Show actionable errors for render, storage/upload, verification, and interrupted download failures.

### 9. Instagram connect

Instagram is the only V1 publishing destination. Use an OAuth-style handoff to the official Meta authorization flow; never ask for Instagram passwords in this product.

- Explain eligibility and permissions before connection, with a neutral pending/denied/error state.
- Show one connected account identity and connection health, with reconnect/disconnect actions. The PRD confirms one Instagram connection per workspace for V1.
- Do not expose tokens or implementation details.
- Show clear ineligible-account and revoked/expired-connection recovery states.

### 10. Instagram review and publish

Design the manual review path from an export-ready video:

1. Select the connected account.
2. Preview the exact render that will be published.
3. Review/edit caption and suggested hashtags; show cover choice only if supported, since it remains open.
4. Validate compatibility and show any blocking issue before publication.
5. Present an explicit **Publish now** confirmation for the exact video, account, and copy. Keep approval distinct from render completion.
6. Show queued/submitting/processing/publishing, published, failed, or outcome-unknown/reconciliation states. On success show the post link/time; on failure give a safe retry or status-check action. Avoid duplicate-post behavior.

Do not show scheduled publishing, automatic recurring posts, or other social channels in V1.

### 11. Media library and usage

- Organize uploaded references, generated scene assets, project previews, and exported videos.
- Provide preview/download and safe rename/delete where supported; warn before removing assets used by active projects.
- Show useful upload validation and storage/retention errors without inventing limits.
- Usage is an activity/history view for generation/render operations. No customer billing, subscriptions, or credit purchase in V1.

## Responsive behavior and themes

- Desktop-first for project management and scene review. Keep a full-width, readable scene workspace and clear side inspector.
- On tablet/mobile, convert the wizard and forms to a single column; use compact scene cards and a full-screen or bottom-sheet scene inspector.
- Do not shrink a desktop timeline to mobile; the V1 design uses scene cards and a preview, not a general editing timeline.
- Ensure all screens work in both light and dark theme, with preference accessible from settings/account menu. Preserve hierarchy, contrast, and meaningful status colors in both themes.
- Maintain readable tap targets and keep primary action accessible on narrow screens.

## Interaction, accessibility, and state design

- Consistent focus, hover, pressed, selected, disabled, loading, success, and error states; visible keyboard focus and screen-reader labels.
- Do not convey status by color alone. Use concise labels and icons with accessible names.
- Make autosave/save state and revision changes clear. Handle stale edits with a clear reload/compare/retry path; do not silently overwrite newer work.
- Confirm destructive actions and operations with cost or irreversible publishing consequences. Present cost estimates as estimates, not invoices.
- Respect reduced motion and do not autoplay audio.
- Use nontechnical language for queued jobs and provider failures. Keep private project/assets scoped to the signed-in creator.

## Stitch deliverables

Create a linked, high-fidelity end-to-end experience, not just a marketing page. Show desktop and responsive states and include both light and dark themes for the main product screens.

1. Sign-in/create-account flow with provider-neutral alternatives and configurable verification/recovery states.
2. First-use Projects empty state and returning-user dashboard with Drafts, In progress, Completed, and Failed states.
3. Guided New Video setup for genre, duration/ratio, language/voice where supported, and idea entry/brainstorming.
4. AI idea selection and editing.
5. Script/storyboard review with ordered scene cards, scene-level editing, references, recurring characters, and revision/approval states.
6. Generation progress with stage/scene states, partial failure, retry, and cancellation.
7. Preview, limited defect repair, export progress, download success, and export failure recovery.
8. Instagram account connection, manual publish review/approval, publish progress, success, and failure/unknown outcomes.
9. Media library and usage-history views.
10. Desktop and mobile examples for dashboard, wizard, and scene review; light and dark themes.

Use a realistic sample project such as an educational video about the water cycle, with coherent scene imagery and captions. Keep all screens, components, state labels, and design tokens consistent. Do not invent endpoint names, provider behavior, fixed prices, unsupported video specifications, or product features outside V1.

## Source alignment and open decisions

The PRD, system design, and API design are review drafts. This brief follows their front-matter decisions where they identify them as confirmed, and preserves unresolved items rather than silently deciding them.

- **Confirmed for this design:** individual creators only; desktop-first responsive mobile; guided wizard plus advanced details; scene-level editing for script/images/narration/captions; light and dark themes; manual Instagram review and explicit approval; usage tracking without V1 billing; one Instagram connection; publish now only.
- **Keep provisional:** Signal / Studio brand; NamasteDev as a style reference; sign-in methods/provider; verification requirement; exact target duration presets and aspect ratios; language list; visual-generation model and final definition of educational animation; repair eligibility; export resolution/codec/FPS/quality/watermark; Instagram cover support; geography, retention, and usage limits.
- **Out of V1:** team workspaces, Brand Kit, content calendar, meetings, other social channels, scheduled publishing, insights/analytics, billing/credits, and general-purpose post-generation timeline editing.
