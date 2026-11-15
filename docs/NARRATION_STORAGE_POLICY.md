# Saved Narration Storage Policy

**Status:** Implemented for local development; production readiness remains open.

## What is stored

- Gemini voice previews are temporary by default. The browser keeps the returned WAV in memory and no automatic save occurs.
- A user can explicitly save the current preview to an active project. The API verifies an owned saved storyboard and stores the WAV in the private Cloudflare R2 bucket. MongoDB stores only the owner, project/storyboard/version, voice, byte length, object key, status, and timestamps.
- Free-tier narration text is sent to Gemini under Google's applicable free-tier data-use terms. Users should not submit sensitive narration.

## Access, limits, and retention

- Narration objects use random server-generated keys. The bucket remains private; playback uses owner-checked, five-minute signed read URLs.
- Limit saved WAV files to 25 MiB each, 20 files per project, and 1 GiB per user. Quota reservations run in a MongoDB transaction. Pending and deleting records count toward quota until cleanup removes their metadata after the object has been deleted.
- Users can list, replay, and explicitly delete saved narration. Archived projects remain readable and deletable but do not accept new saves.
- Keep saved narration until the user deletes it. Expired incomplete saves and failed deletions are retried by a periodic cleanup worker. There is no age-based expiration for ready narration.
- Account-deletion purge and a published production retention schedule are not implemented; do not enable this feature for production accounts until that lifecycle is addressed.

## API behavior

- Save requires an authenticated owner, active project, owned storyboard, supported voice and complete RIFF/WAVE data. The API returns only metadata, never a private key.
- Preview URL creation and deletion require the owning account and project. Repeating deletion is safe; cleanup retries storage failures.
- Storage-limit, invalid-file, missing-resource, and storage errors use the common API error response.
