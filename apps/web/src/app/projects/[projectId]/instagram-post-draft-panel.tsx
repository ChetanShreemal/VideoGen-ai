"use client";

import { useEffect, useState } from "react";
import {
  createInstagramPostDraftRequestSchema,
  instagramAccountResponseSchema,
  instagramPostDraftResponseSchema,
  instagramPostDraftsResponseSchema,
  projectExportFileResponseSchema,
  projectExportsResponseSchema,
  updateInstagramPostDraftRequestSchema,
  type InstagramPostDraft,
  type ProjectExport,
} from "@videogen/contracts";
import { apiBaseURL } from "@/lib/auth-client";

export function InstagramPostDraftPanel({ projectId, revision }: { projectId: string; revision: number }) {
  const [exports, setExports] = useState<ProjectExport[]>([]);
  const [drafts, setDrafts] = useState<InstagramPostDraft[]>([]);
  const [selectedExport, setSelectedExport] = useState("");
  const [caption, setCaption] = useState("");
  const [editing, setEditing] = useState("");
  const [connected, setConnected] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setPreviewUrl(""); setDrafts([]); setExports([]);
    void Promise.all([
      fetch(`${apiBaseURL}/projects/${projectId}/exports`, { credentials: "include", cache: "no-store", signal: controller.signal }),
      fetch(`${apiBaseURL}/projects/${projectId}/instagram-posts`, { credentials: "include", cache: "no-store", signal: controller.signal }),
      fetch(`${apiBaseURL}/instagram/account`, { credentials: "include", cache: "no-store", signal: controller.signal }),
    ]).then(async ([exportResponse, draftResponse, accountResponse]) => {
      if (!exportResponse.ok || !draftResponse.ok || !accountResponse.ok) throw new Error("Post preparation data could not be loaded.");
      const exportItems = projectExportsResponseSchema.parse(await exportResponse.json()).data.items;
      const postItems = instagramPostDraftsResponseSchema.parse(await draftResponse.json()).data.items;
      const account = instagramAccountResponseSchema.parse(await accountResponse.json()).data.account;
      if (controller.signal.aborted) return;
      setExports(exportItems); setDrafts(postItems); setConnected(Boolean(account));
      setSelectedExport((current) => current || exportItems[0]?.id || "");
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Post preparation data could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, revision]);

  async function preview(item: ProjectExport) {
    setWorking(true); setError("");
    try {
      const response = await fetch(`${apiBaseURL}/projects/${projectId}/exports/${item.id}/preview`, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("The selected video preview could not be loaded.");
      setPreviewUrl(projectExportFileResponseSchema.parse(await response.json()).data.url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The selected video preview could not be loaded."); }
    finally { setWorking(false); }
  }

  async function saveDraft() {
    if (!selectedExport) return;
    setWorking(true); setError(""); setMessage("");
    try {
      const updating = drafts.find((draft) => draft.id === editing);
      const payload = updating
        ? updateInstagramPostDraftRequestSchema.parse({ expectedRevision: updating.revision, exportId: selectedExport, caption })
        : createInstagramPostDraftRequestSchema.parse({ exportId: selectedExport, caption });
      const response = await fetch(`${apiBaseURL}/projects/${projectId}/instagram-posts${updating ? `/${updating.id}` : ""}`, {
        method: updating ? "PATCH" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(response.status === 409 ? "This draft changed elsewhere. Reload the project and try again." : "Post draft could not be saved.");
      const item = instagramPostDraftResponseSchema.parse(await response.json()).data.item;
      setDrafts((current) => [item, ...current.filter((draft) => draft.id !== item.id)]);
      setEditing(item.id); setMessage("Draft saved. It has not been published.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Post draft could not be saved."); }
    finally { setWorking(false); }
  }

  function editDraft(item: InstagramPostDraft) {
    setEditing(item.id); setSelectedExport(item.exportId); setCaption(item.caption); setMessage(""); setError(""); setPreviewUrl("");
  }

  async function approveDraft(item: InstagramPostDraft) {
    if (!window.confirm("Approve this exact video and caption for a future Instagram publish step? Nothing will be published now.")) return;
    setWorking(true); setError(""); setMessage("");
    try {
      const response = await fetch(`${apiBaseURL}/projects/${projectId}/instagram-posts/${item.id}/approve`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(response.status === 409 ? "Connect Instagram and confirm the saved video is available before approving." : "Post approval could not be saved.");
      const approved = instagramPostDraftResponseSchema.parse(await response.json()).data.item;
      setDrafts((current) => current.map((draft) => draft.id === approved.id ? approved : draft));
      setMessage("Approved for the future publishing step. Nothing was published.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Post approval could not be saved."); }
    finally { setWorking(false); }
  }

  const selected = exports.find((item) => item.id === selectedExport);
  return <section className="detail-panel instagram-post-panel" aria-labelledby="instagram-post-title">
    <div><p className="eyebrow">CHANNELS · REVIEW BEFORE PUBLISHING</p><h2 id="instagram-post-title">Prepare an Instagram post</h2><p className="detail-copy">Choose a saved video, write its caption, then save a draft. Approval records the reviewed version; it never publishes automatically.</p></div>
    {error && <p className="form-feedback error" role="alert">{error}</p>}{message && <p className="form-feedback info" role="status">{message}</p>}
    {loading ? <p className="detail-copy">Loading videos and drafts…</p> : exports.length === 0 ? <p className="reference-empty">Save a rendered MP4 to this project before preparing an Instagram post.</p> : <>
      <label className="field"><span>Saved video</span><select value={selectedExport} onChange={(event) => { setSelectedExport(event.target.value); setPreviewUrl(""); }} disabled={working}><option value="" disabled>Select a saved export</option>{exports.map((item) => <option key={item.id} value={item.id}>{item.fileName} · {item.width} × {item.height}</option>)}</select></label>
      {selected && <button className="quiet-button" type="button" disabled={working} onClick={() => void preview(selected)}>{previewUrl ? "Refresh video preview" : "Preview selected video"}</button>}
      {previewUrl && <video className="project-export-preview" src={previewUrl} controls playsInline preload="metadata" aria-label="Instagram post video preview" />}
      <label className="field"><span>Caption <small>{caption.length}/2,200</small></span><textarea maxLength={2200} rows={5} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Write a caption for your video…" disabled={working} /></label>
      <div className="instagram-draft-controls"><button className="primary-button" type="button" onClick={() => void saveDraft()} disabled={working || !selectedExport}>{working ? "Saving…" : editing ? "Save changes" : "Save draft"}</button><span>{connected ? "Instagram account connected" : "Connect a professional account before approving"}</span></div>
      {drafts.length > 0 && <div className="instagram-drafts-list"><h3>Post drafts</h3>{drafts.map((item) => <article className="instagram-draft-card" key={item.id}>
        <div><strong>{item.fileName}</strong><span className={`status-pill ${item.status === "approved" ? "instagram-connected-status" : ""}`}>{item.status === "approved" ? "APPROVED" : "DRAFT"}</span><small>{item.caption || "No caption yet"}</small><small>Updated {new Date(item.updatedAt).toLocaleString()}</small></div>
        <div className="project-export-actions"><button className="quiet-button" type="button" disabled={working} onClick={() => editDraft(item)}>Edit</button>{item.status === "draft" && <button className="quiet-button" type="button" disabled={working || !connected} onClick={() => void approveDraft(item)}>Approve for publishing</button>}</div>
      </article>)}</div>}
    </>}
  </section>;
}
