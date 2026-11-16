# Reference Upload Policy

**Status:** Provisional V1 baseline. Revisit limits before public launch.

This policy covers user-supplied image and video references attached to a project. Generated media and final exports will have separate limits.

## Accepted uploads

| Type | Accepted formats | Per-file limit | Media limit |
|---|---|---:|---|
| Image | JPEG, PNG, WebP | 20 MiB | Up to 8,000 × 8,000 px and 40 megapixels; decode and verify dimensions, and reject malformed or unsupported content |
| Video | MP4, QuickTime MOV | 100 MiB | Up to 30 seconds and 1920×1080; inspect the actual container/codecs and dimensions server-side |

Reject SVG, GIF, HEIC/HEIF, and unknown types for the initial slice. The browser's MIME type and file name are hints only; the API must verify object length, signature/content, and media metadata before marking an asset ready. Require the uploader to confirm they have the rights and consent needed to use the reference.

## Quotas and object access

- Maximum 20 reference assets per project and 1 GiB of reference media per user.
- Store bytes in a private Cloudflare R2 bucket. MongoDB stores ownership, project association, object key, verified MIME type, size, checksum, media metadata, and status only.
- Generate random object keys on the server; never use a user file name as an object key or return private keys to the web client.
- Use a 10-minute presigned `PUT` for upload and a 5-minute presigned `GET` for preview/download. Scope each URL to one object and the expected content type; keep the bucket private and configure CORS for the application origins only.
- Sign the declared `Content-Length` on each upload URL. A live R2 check confirmed a 2-byte `PUT` against a 1-byte intent receives HTTP 403 and leaves no object behind.
- Treat a presigned URL as a bearer capability: R2 allows it to be reused until expiry. Keep upload intents pending until a server-side `HEAD` plus content inspection succeeds; make completion idempotent and do not overwrite an existing ready asset.

Cloudflare documents that presigned URLs grant a specific S3 operation on a specific object until expiry, can be reused during that period, and require bucket CORS for browser requests: [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

## Retention and deletion

- Keep reference assets while their project exists, including when a project is archived; archiving alone does not delete media.
- Provide explicit asset deletion with a warning when storyboard scenes or characters still reference the asset. Remove it from normal access immediately, then delete the R2 object and metadata through a retryable cleanup operation.
- Account deletion must purge that account's assets and projects. Do not configure age-based bucket expiration for user references in the initial release; review actual storage use and publish a retention period before production.
- Until account deletion and retryable object cleanup are implemented, do not expose uploads to production users.

## Implementation sequence

1. **Done locally:** Create a private R2 bucket and least-privilege API token with object read/write/delete for that bucket only; configure endpoint, bucket, access key, and secret in local secrets. The local bucket connection was verified without printing credentials.
2. **API foundation implemented:** Owner-scoped signed upload intents, Mongo metadata, project/user quota checks, content signature and media metadata verification, short-lived preview URLs, and retryable delete routes.
3. **Local browser setup verified:** The bucket allows `GET`, `HEAD`, and `PUT` from `http://localhost:3000` and `http://127.0.0.1:3000`, with `Content-Type` as the allowed request header. Add only the production web origin before deployment. A live expiry check confirmed the cleanup worker removes an expired pending record and both R2 objects.
4. **Remaining before production:** Exercise complete upload/read/delete flows in production-like deployment and implement account-deletion purge. Upload intents expire after 10 minutes; a periodic API cleanup pass reclaims expired pending uploads and their R2 objects, with failed cleanup attempts retried on later passes.
5. Keep verifying file type/size/media metadata, ownership isolation, expiry, duplicate completion, deletion, and narrow layouts as the project UI changes.

Video verification invokes `ffprobe` from `PATH` by default; set `FFPROBE_PATH` to its executable path in deployed environments where it is installed elsewhere. The local development machine has `ffprobe` available.
