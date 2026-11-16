"use client";

import { useCallback, useEffect, useState } from "react";
import { instagramAccountResponseSchema, instagramConnectResponseSchema } from "@videogen/contracts";
import { authClient, apiBaseURL } from "@/lib/auth-client";
import { WorkspaceShell } from "./workspace-shell";

export function InstagramConnectPage() {
  const { data: session, isPending } = authClient.useSession();
  const [configured, setConfigured] = useState(false);
  const [account, setAccount] = useState<ReturnType<typeof instagramAccountResponseSchema.parse>["data"]["account"]>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadAccount = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseURL}/instagram/account`, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("Instagram connection status could not be loaded.");
      const result = instagramAccountResponseSchema.parse(await response.json());
      setConfigured(result.data.configured);
      setAccount(result.data.account);
    } catch {
      setError("Instagram connection status could not be loaded. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isPending && !session) window.location.replace("/");
    if (session) void loadAccount();
  }, [isPending, session, loadAccount]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("instagram");
    if (result === "connected") setMessage("Your Instagram professional account is connected.");
    if (result === "cancelled") setMessage("Instagram authorization was canceled.");
    if (result === "error") setError("Instagram could not be connected. Check the app setup and try again.");
    if (result) {
      url.searchParams.delete("instagram");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  async function startConnection() {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseURL}/instagram/oauth/start`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("Instagram login could not be started. Check the Meta app configuration.");
      const result = instagramConnectResponseSchema.parse(await response.json());
      window.location.assign(result.data.authorizationUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Instagram login could not be started. Try again.");
      setWorking(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Remove the saved Instagram connection from VideoGen?")) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseURL}/instagram/account`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("Instagram could not be disconnected. Try again.");
      setAccount(null);
      setMessage("The saved Instagram connection was removed from VideoGen.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Instagram could not be disconnected. Try again.");
    } finally {
      setWorking(false);
    }
  }

  const name = session?.user.name ?? "Creator";
  const email = session?.user.email ?? "";
  return (
    <WorkspaceShell name={name} email={email} active="instagram">
      <main className="workspace-page">
        <div className="workspace-main">
          <header className="workspace-heading">
            <div><p className="eyebrow">CHANNELS · ACCOUNT CONNECTION</p><h1>Instagram Connect</h1><p className="form-subtitle">Connect your professional account to prepare for reviewed publishing.</p></div>
          </header>

          <section className="detail-panel instagram-connect-panel" aria-labelledby="instagram-connect-title">
            <div className="instagram-connect-copy">
              <span className="instagram-connect-icon material-symbols-outlined" aria-hidden="true">photo_camera</span>
              <div>
                <p className="eyebrow">OFFICIAL INSTAGRAM LOGIN</p>
                <h2 id="instagram-connect-title">Account connection</h2>
                <p className="detail-copy">Use Meta’s authorization page to connect an Instagram professional account. VideoGen stores the account token encrypted on the server; it is never sent to this browser.</p>
              </div>
            </div>

            {loading || isPending ? <p className="project-empty" role="status">Checking account connection…</p> : account ? (
              <div className="instagram-account-card">
                <div className="instagram-account-avatar" aria-hidden="true">@</div>
                <div className="instagram-account-copy"><strong>@{account.username}</strong><span>{account.accountType === "Media_Creator" ? "Creator account" : account.accountType === "Business" ? "Business account" : "Professional account"}</span><small>Connected {new Date(account.connectedAt).toLocaleDateString()} · Access expires {new Date(account.expiresAt).toLocaleDateString()}</small></div>
                <span className="status-pill instagram-connected-status">CONNECTED</span>
              </div>
            ) : (
              <div className="instagram-not-connected">
                <strong>No Instagram account connected</strong>
                <p>Connect a Business or Creator account. Personal Instagram accounts are not supported by this API.</p>
              </div>
            )}

            {error && <p className="form-feedback error" role="alert">{error}</p>}
            {message && <p className="form-feedback info" role="status">{message}</p>}

            {!loading && !account && <button className="primary-button instagram-action" type="button" onClick={() => void startConnection()} disabled={!configured || working}>
              <span className="material-symbols-outlined" aria-hidden="true">link</span>{working ? "Opening Instagram…" : "Connect Instagram"}
            </button>}
            {!loading && account && <button className="quiet-button instagram-action" type="button" onClick={() => void disconnect()} disabled={working}>{working ? "Disconnecting…" : "Disconnect account"}</button>}

            {!configured && <div className="instagram-setup-note"><strong>Meta app setup is required</strong><p>Add the Instagram App ID, App Secret, callback URL and a 32-byte token-encryption key to the API environment. Then add that exact callback URL to the Instagram Login settings in the Meta app dashboard.</p></div>}
            <p className="instagram-privacy-note">Disconnecting removes the encrypted token from VideoGen. To revoke the app’s permission as well, remove VideoGen from Instagram’s connected apps.</p>
          </section>
        </div>
      </main>
    </WorkspaceShell>
  );
}
