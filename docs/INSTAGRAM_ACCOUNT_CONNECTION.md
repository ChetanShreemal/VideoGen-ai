# Instagram account connection

**Status:** First connection slice implemented; live OAuth requires a configured Meta app and an eligible test account.

## Scope

This slice connects one Instagram professional account to the signed-in user's private workspace. It uses Meta's Instagram Login flow, requests only `instagram_business_basic`, exchanges the authorization code and long-lived token on the API server, fetches the account username/type, and stores the token encrypted with AES-256-GCM. The browser receives account display data only.

Personal Instagram accounts are not supported by this API. Publishing, token refresh, webhooks, app review for other users, and external grant revocation are separate work.

## Meta app setup

1. Create a Business-type Meta app and add the Instagram product with Instagram Login.
2. Configure the exact OAuth redirect URI below in the app's Business Login settings.
3. Add an Instagram Business or Creator test account to the app and grant the required test access.
4. Set these API environment values (never commit the real values):
   - `INSTAGRAM_APP_ID`
   - `INSTAGRAM_APP_SECRET`
   - `INSTAGRAM_REDIRECT_URI` — the example value is `http://127.0.0.1:4000/api/v1/instagram/oauth/callback`; use the exact URI registered in Meta.
   - `SOCIAL_TOKEN_ENCRYPTION_KEY` — 32 random bytes represented as exactly 64 hex characters. Keep it stable; changing it makes stored tokens unreadable.
   - `INSTAGRAM_API_VERSION` — optional, defaults to `v27.0`.
5. Restart the API and open **Instagram Connect** from the workspace sidebar.

## Security and lifecycle

- OAuth state is generated with a cryptographically secure random value, stored as a SHA-256 hash, expires after ten minutes, and is consumed once.
- State binds the callback to the initiating workspace and trusted web origin; workspace ownership is derived from the authenticated session when login starts.
- Access tokens are encrypted before MongoDB persistence. Status responses never return tokens or Instagram IDs.
- Disconnect deletes the locally stored credential. Users should also revoke the app grant from Instagram's connected-app settings when they want to remove Meta's authorization.
- One Instagram connection per personal workspace is enforced by a unique database index.

## API

- `GET /api/v1/instagram/account` — authenticated connection summary and whether the Meta integration is configured.
- `POST /api/v1/instagram/oauth/start` — authenticated; creates state and returns the Meta authorization URL.
- `GET /api/v1/instagram/oauth/callback` — one-time OAuth callback; redirects to the initiating trusted web origin.
- `DELETE /api/v1/instagram/account` — authenticated removal of the locally stored connection.

## Remaining verification

Configure the Meta app and professional test account, then verify successful OAuth, user denial, expired/replayed state rejection, encrypted persistence, reconnect replacement, and local disconnect. Do not publish content until the separate review-and-approval workflow is implemented.
