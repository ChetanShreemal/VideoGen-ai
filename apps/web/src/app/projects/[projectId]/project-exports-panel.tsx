"use client";

import { useEffect, useState } from "react";
import {
  projectExportFileResponseSchema,
  projectExportsResponseSchema,
  type ProjectExport,
} from "@videogen/contracts";
import { apiBaseURL } from "@/lib/auth-client";

interface ProjectExportsPanelProps { projectId: string; revision: number }

export function ProjectExportsPanel({ projectId, revision }: ProjectExportsPanelProps) {
  const [items, setItems] = useState<ProjectExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState("");
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(`${apiBaseURL}/projects/${projectId}/exports`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Saved exports could not be loaded.");
        return projectExportsResponseSchema.parse(await response.json()).data.items;
      })
      .then((exports) => { if (!controller.signal.aborted) setItems(exports); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Saved exports could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, revision]);

  async function openExport(exportItem: ProjectExport, disposition: "preview" | "download") {
    setWorkingId(exportItem.id);
    setError("");
    try {
      const response = await fetch(`${apiBaseURL}/projects/${projectId}/exports/${exportItem.id}/${disposition}`, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error(disposition === "preview" ? "Export preview could not be opened." : "Export download could not be started.");
      const result = projectExportFileResponseSchema.parse(await response.json());
      if (disposition === "preview") setPreviewUrls((current) => ({ ...current, [exportItem.id]: result.data.url }));
      else {
        const link = document.createElement("a");
        link.href = result.data.url;
        link.rel = "noreferrer";
        link.download = exportItem.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Export could not be opened."); }
    finally { setWorkingId(""); }
  }

  async function remove(exportItem: ProjectExport) {
    if (!window.confirm(`Delete “${exportItem.fileName}” from this project?`)) return;
    setWorkingId(exportItem.id);
    setError("");
    try {
      const response = await fetch(`${apiBaseURL}/projects/${projectId}/exports/${exportItem.id}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("Export deletion is still in progress. Try again shortly.");
      setItems((current) => current.filter((item) => item.id !== exportItem.id));
      setPreviewUrls((current) => { const next = { ...current }; delete next[exportItem.id]; return next; });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Export could not be deleted."); }
    finally { setWorkingId(""); }
  }

  return <section className="detail-panel project-exports-panel" aria-labelledby="project-exports-title">
    <div><p className="eyebrow">PROJECT LIBRARY</p><h2 id="project-exports-title">Saved exports</h2><p className="detail-copy">Keep completed MP4s with this project so they remain available after you close or refresh the browser.</p></div>
    {error && <p className="form-feedback error" role="alert">{error}</p>}
    {loading ? <p className="detail-copy">Loading saved exports…</p> : items.length === 0 ? <p className="reference-empty">No saved exports yet. Render a video above and choose “Save to project”.</p> : <div className="project-exports-list">{items.map((item) => <article className="project-export-item" key={item.id}>
      <div className="project-export-info"><strong>{item.fileName}</strong><small>{item.width} × {item.height} · {Math.round(item.durationSeconds)} sec · {(item.sizeBytes / (1024 * 1024)).toFixed(1)} MB · {new Date(item.createdAt).toLocaleDateString()}</small></div>
      <div className="project-export-actions"><button className="quiet-button" type="button" disabled={workingId === item.id} onClick={() => void openExport(item, "preview")}>{workingId === item.id ? "Opening…" : previewUrls[item.id] ? "Refresh preview" : "Preview"}</button><button className="quiet-button" type="button" disabled={workingId === item.id} onClick={() => void openExport(item, "download")}>Download</button><button className="reference-remove" type="button" disabled={workingId === item.id} onClick={() => void remove(item)}>Delete</button></div>
      {previewUrls[item.id] && <video className="project-export-preview" src={previewUrls[item.id]} controls playsInline preload="metadata" aria-label={`Saved export preview: ${item.fileName}`} />}
    </article>)}</div>}
  </section>;
}
