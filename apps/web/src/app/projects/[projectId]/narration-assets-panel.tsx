"use client";

import { useEffect, useState } from "react";
import {
  assetPreviewResponseSchema,
  projectNarrationAssetsResponseSchema,
  type ProjectNarrationAsset,
} from "@videogen/contracts";
import { apiBaseURL } from "@/lib/auth-client";

interface NarrationAssetsPanelProps {
  projectId: string;
  active: boolean;
  storyboardId?: string;
  audio: Blob | null;
  voiceName: string;
  onMediaChanged?: () => void;
}

export function NarrationAssetsPanel({ projectId, active, storyboardId, audio, voiceName, onMediaChanged }: NarrationAssetsPanelProps) {
  const [items, setItems] = useState<ProjectNarrationAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workingId, setWorkingId] = useState("");
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadItems(signal?: AbortSignal) {
    const response = await fetch(`${apiBaseURL}/projects/${projectId}/narration-assets`, {
      credentials: "include", cache: "no-store", signal,
    });
    if (!response.ok) throw new Error("Saved narration could not be loaded.");
    const result = projectNarrationAssetsResponseSchema.parse(await response.json());
    setItems(result.data.items);
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setItems([]);
    setPreviewUrls({});
    setError("");
    void loadItems(controller.signal)
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Saved narration could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId]);

  async function saveNarration() {
    if (!audio || !storyboardId || !active || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseURL}/projects/${projectId}/storyboards/${storyboardId}/narration-assets?voiceName=${encodeURIComponent(voiceName)}`, {
        method: "POST", credentials: "include", headers: { "content-type": "audio/wav" }, body: audio,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message || "Narration could not be saved.");
      }
      await loadItems();
      onMediaChanged?.();
      setMessage("Narration saved privately to this project.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Narration could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function openPreview(asset: ProjectNarrationAsset) {
    setWorkingId(asset.id);
    setError("");
    try {
      const response = await fetch(`${apiBaseURL}/projects/${projectId}/narration-assets/${asset.id}/preview`, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("Saved narration preview could not be opened.");
      const result = assetPreviewResponseSchema.parse(await response.json());
      setPreviewUrls((current) => ({ ...current, [asset.id]: result.data.url }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saved narration preview could not be opened.");
    } finally {
      setWorkingId("");
    }
  }

  async function remove(asset: ProjectNarrationAsset) {
    if (!window.confirm("Delete this saved narration? This cannot be undone.")) return;
    setWorkingId(asset.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseURL}/projects/${projectId}/narration-assets/${asset.id}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message || "Saved narration could not be deleted.");
      }
      setItems((current) => current.filter((item) => item.id !== asset.id));
      setPreviewUrls((current) => { const next = { ...current }; delete next[asset.id]; return next; });
      onMediaChanged?.();
      setMessage("Saved narration deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saved narration could not be deleted.");
    } finally {
      setWorkingId("");
    }
  }

  return <section className="narration-library" aria-labelledby="narration-library-title">
    <div className="narration-library-heading"><div><p className="eyebrow">PRIVATE PROJECT STORAGE</p><h3 id="narration-library-title">Saved narration</h3><p className="detail-copy">Generated previews are temporary until you choose to save them. Saved audio stays private in this project until you delete it.</p></div><span className="reference-count">{items.length} / 20</span></div>
    {audio && active && <button className="quiet-button narration-save-button" type="button" disabled={saving} onClick={() => void saveNarration()}>{saving ? "Saving narration…" : "Save this narration"}</button>}
    {error && <p className="form-feedback error" role="alert">{error}</p>}
    {message && <p className="form-feedback info" role="status">{message}</p>}
    {loading ? <p className="detail-copy">Loading saved narration…</p> : items.length === 0 ? <p className="narration-empty">No saved narration yet.</p> : <div className="narration-assets-list">{items.map((asset) => <article className="narration-asset" key={asset.id}>
      <div className="narration-asset-copy"><strong>Storyboard v{asset.storyboardVersion} · {asset.voiceName}</strong><small>{(asset.sizeBytes / (1024 * 1024)).toFixed(1)} MB · {new Date(asset.createdAt).toLocaleDateString()}</small></div>
      <div className="narration-asset-actions"><button className="quiet-button" type="button" disabled={workingId === asset.id} onClick={() => void openPreview(asset)}>{workingId === asset.id ? "Opening…" : previewUrls[asset.id] ? "Refresh link" : "Play saved"}</button><button className="reference-remove" type="button" disabled={workingId === asset.id} onClick={() => void remove(asset)}>Delete</button></div>
      {previewUrls[asset.id] && <audio className="narration-saved-player" controls preload="metadata" src={previewUrls[asset.id]}>Your browser does not support audio playback.</audio>}
    </article>)}</div>}
  </section>;
}
