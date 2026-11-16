"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiErrorResponseSchema,
  assetCompletionResponseSchema,
  assetPreviewResponseSchema,
  assetUploadIntentResponseSchema,
  assetUploadRequestSchema,
  projectAssetsResponseSchema,
  type ProjectAsset,
} from "@videogen/contracts";
import { apiBaseURL } from "@/lib/auth-client";

type Props = { projectId: string; active: boolean; onMediaChanged?: () => void };

export function ReferenceAssetsPanel({ projectId, active, onMediaChanged }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 5_000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const loadAssets = useCallback(async (signal: AbortSignal): Promise<ProjectAsset[]> => {
    const response = await fetch(`${apiBaseURL}/projects/${projectId}/assets`, { credentials: "include", cache: "no-store", signal });
    if (!response.ok) throw new Error("Reference assets could not be loaded.");
    const payload = projectAssetsResponseSchema.parse(await response.json());
    return payload.data.items;
  }, [projectId]);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setAssets([]);
    setPreviewUrls({});
    setError("");
    setMessage("");
    setLoading(true);
    void loadAssets(controller.signal).then((items) => { if (current) setAssets(items); })
      .catch(() => { if (current && !controller.signal.aborted) setError("Reference assets could not be loaded."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [loadAssets]);

  async function openPreview(asset: ProjectAsset) {
    setError("");
    try {
      const response = await fetch(`${apiBaseURL}/projects/${projectId}/assets/${asset.id}/preview`, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("A preview link could not be created.");
      const payload = assetPreviewResponseSchema.parse(await response.json());
      setPreviewUrls((current) => ({ ...current, [asset.id]: payload.data.url }));
    } catch { setError("A preview could not be opened. Try again."); }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    if (!rightsConfirmed) { setError("Confirm that you have permission to use these reference files."); return; }
    setWorking(true); setError(""); setMessage("");
    let uploaded = 0;
    try {
      for (const file of Array.from(files)) {
        const input = assetUploadRequestSchema.safeParse({ fileName: file.name, contentType: file.type, sizeBytes: file.size, rightsConfirmed: true });
        if (!input.success) throw new Error(`${file.name}: unsupported type or file size.`);
        const intentResponse = await fetch(`${apiBaseURL}/projects/${projectId}/assets/upload-intents`, {
          method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(input.data),
        });
        if (!intentResponse.ok) throw new Error(intentResponse.status === 413 ? "The project or account storage limit has been reached." : "An upload could not be started.");
        const intent = assetUploadIntentResponseSchema.parse(await intentResponse.json());
        try {
          const stored = await fetch(intent.data.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
          if (!stored.ok) throw new Error("Cloud storage rejected the upload. Check the bucket CORS policy and retry.");
          const completeResponse = await fetch(`${apiBaseURL}/projects/${projectId}/assets/${intent.data.assetId}/complete`, { method: "POST", credentials: "include" });
          if (!completeResponse.ok) {
            const payload = apiErrorResponseSchema.safeParse(await completeResponse.json().catch(() => null));
            throw new Error(payload.success ? payload.data.error.message : `The uploaded file could not be verified (HTTP ${completeResponse.status}). Retry the upload.`);
          }
          const result = assetCompletionResponseSchema.parse(await completeResponse.json());
          setAssets((current) => [result.data.asset, ...current.filter((item) => item.id !== result.data.asset.id)]);
          onMediaChanged?.();
          uploaded += 1;
        } catch (cause) {
          await fetch(`${apiBaseURL}/projects/${projectId}/assets/${intent.data.assetId}`, { method: "DELETE", credentials: "include" }).catch(() => undefined);
          throw cause;
        }
      }
      setMessage(`${uploaded} reference ${uploaded === 1 ? "file was" : "files were"} uploaded and verified.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed. Try again.");
    } finally {
      setWorking(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function removeAsset(asset: ProjectAsset) {
    if (!window.confirm(`Remove “${asset.fileName}”? If a storyboard uses this reference, that link will no longer work.`)) return;
    setWorking(true); setError(""); setMessage("");
    try {
      const response = await fetch(`${apiBaseURL}/projects/${projectId}/assets/${asset.id}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("Removal is still in progress. Try again shortly.");
      setAssets((current) => current.filter((item) => item.id !== asset.id));
      setPreviewUrls((current) => { const next = { ...current }; delete next[asset.id]; return next; });
      onMediaChanged?.();
      setMessage("Reference removed.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Reference could not be removed."); }
    finally { setWorking(false); }
  }

  return <section className="detail-panel reference-assets-panel" aria-labelledby="reference-assets-title">
    <div className="reference-assets-heading"><div><p className="eyebrow">SOURCE MATERIAL · STEP 1</p><h2 id="reference-assets-title">Reference media</h2><p className="detail-copy">Add images or short clips to guide your storyboard. Files stay private to your account.</p></div><span className="reference-count">{assets.length} / 20</span></div>
    {error && <p className="form-feedback error" role="alert">{error}</p>}{message && <p className="form-feedback info" role="status">{message}</p>}
    {active && <div className="reference-upload-box"><input ref={fileInput} className="reference-file-input" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple disabled={working || assets.length >= 20} onChange={(event) => void uploadFiles(event.currentTarget.files)} aria-label="Choose reference images or videos" /><button type="button" className="quiet-button" disabled={working || assets.length >= 20} onClick={() => fileInput.current?.click()}><span className="material-symbols-outlined" aria-hidden="true">upload</span>{working ? "Uploading…" : "Add reference media"}</button><span className="reference-limits">JPEG, PNG, WebP up to 20 MB and 40 MP · MP4, MOV up to 100 MB / 30 sec at 1920 × 1080</span><label className="reference-rights"><input type="checkbox" checked={rightsConfirmed} disabled={working} onChange={(event) => setRightsConfirmed(event.target.checked)} /><span>I have permission to use these files as video references.</span></label></div>}
    {loading ? <p className="detail-copy">Loading reference media…</p> : assets.length === 0 ? <p className="reference-empty">No reference media yet. Add a file to guide the creative plan.</p> : <div className="reference-assets-grid">{assets.map((asset) => <article className="reference-asset-card" key={asset.id}>
      <div className="reference-preview">{previewUrls[asset.id] ? asset.contentType.startsWith("image/") ? <img src={previewUrls[asset.id]} alt={asset.fileName} referrerPolicy="no-referrer" /> : <video src={previewUrls[asset.id]} controls preload="metadata" aria-label={asset.fileName} /> : <span className="material-symbols-outlined" aria-hidden="true">{asset.contentType.startsWith("image/") ? "image" : "movie"}</span>}</div>
      <div className="reference-asset-copy"><strong title={asset.fileName}>{asset.fileName}</strong><small>{asset.media.type === "video" ? `${asset.media.width} × ${asset.media.height} · ${Math.round(asset.media.durationSeconds)} sec` : `${asset.media.width} × ${asset.media.height}`} · {(asset.sizeBytes / (1024 * 1024)).toFixed(1)} MB</small></div>
      <div className="reference-asset-actions"><button type="button" className="quiet-button" disabled={working} onClick={() => void openPreview(asset)}>{previewUrls[asset.id] ? "Refresh preview" : "Preview"}</button><button type="button" className="reference-remove" disabled={working} onClick={() => void removeAsset(asset)} aria-label={`Remove ${asset.fileName}`}>Remove</button></div>
    </article>)}</div>}
  </section>;
}
