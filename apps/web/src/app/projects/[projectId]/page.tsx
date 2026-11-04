"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  projectResponseEnvelopeSchema,
  type ProjectResponse,
  updateProjectRequestSchema,
} from "@videogen/contracts";
import { apiBaseURL, authClient } from "@/lib/auth-client";

export default function ProjectDetailsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (sessionPending) return;
    if (!session) {
      window.location.replace("/");
      return;
    }
    let current = true;
    setLoading(true);
    void fetch(`${apiBaseURL}/projects/${projectId}`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Project unavailable");
        const result = projectResponseEnvelopeSchema.parse(await response.json());
        if (current) {
          setProject(result.data.project);
          setTitle(result.data.project.title);
          setTopic(result.data.project.topic ?? "");
        }
      })
      .catch(() => { if (current) setError("This project could not be found or is unavailable."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [projectId, session, sessionPending]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const parsed = updateProjectRequestSchema.safeParse({ title, topic: topic.trim() || null });
    if (!parsed.success) { setError("Add a title up to 120 characters and a topic up to 2,000 characters."); return; }
    setWorking(true);
    try {
      const response = await fetch(`${apiBaseURL}/projects/${projectId}`, {
        method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      if (!response.ok) throw new Error("Save failed");
      const result = projectResponseEnvelopeSchema.parse(await response.json());
      setProject(result.data.project);
      setTitle(result.data.project.title);
      setTopic(result.data.project.topic ?? "");
      setMessage("Project details saved.");
    } catch { setError("Your changes could not be saved. Try again."); }
    finally { setWorking(false); }
  }

  async function changeStatus(action: "archive" | "restore") {
    setWorking(true); setError(""); setMessage("");
    try {
      const response = await fetch(`${apiBaseURL}/projects/${projectId}/${action}`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("Status update failed");
      const result = projectResponseEnvelopeSchema.parse(await response.json());
      setProject(result.data.project);
      setMessage(action === "archive" ? "Project archived. You can restore it from your archive." : "Project restored to your active projects.");
    } catch { setError(`Project could not be ${action === "archive" ? "archived" : "restored"}. Try again.`); }
    finally { setWorking(false); }
  }

  return <main className="workspace-page">
    <header className="workspace-topbar"><a className="brand" href="/" aria-label="VideoGen home"><span className="brand-mark" aria-hidden="true">V</span><span>VideoGen</span></a><Link className="quiet-button back-link" href="/">← Projects</Link></header>
    <section className="project-detail">
      {loading ? <div className="project-empty">Loading project…</div> : !project ? <div className="project-empty"><h1>Project unavailable</h1><p>{error}</p><Link className="quiet-button" href="/">Back to projects</Link></div> : <>
        <div className="detail-heading"><div><p className="eyebrow">PROJECT WORKSPACE</p><h1>{project.title}</h1><p className="form-subtitle">Created {new Date(project.createdAt).toLocaleDateString()} · Last updated {new Date(project.updatedAt).toLocaleDateString()}</p></div><span className={`status-pill ${project.status}`}>{project.status}</span></div>
        {error && <p className="form-feedback error" role="alert">{error}</p>}{message && <p className="form-feedback info" role="status">{message}</p>}
        <div className="detail-layout"><form className="detail-panel" onSubmit={save}><div><p className="eyebrow">PROJECT DETAILS</p><h2>Shape the starting point</h2><p className="detail-copy">These details stay with your project and can be changed as your story develops.</p></div><label className="field"><span>Project title</span><input required maxLength={120} disabled={project.status !== "active" || working} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="field"><span>Video topic</span><textarea maxLength={2000} disabled={project.status !== "active" || working} value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Describe the idea behind this video" /></label>{project.status === "active" && <button className="primary-button" disabled={working} type="submit">{working ? "Saving…" : "Save changes"}<span aria-hidden="true">→</span></button>}</form>
          <aside className="detail-panel project-settings-panel"><p className="eyebrow">GENERATION SETTINGS</p><h2>Ready when you are</h2><p className="detail-copy">Set these up in a future step when you turn this idea into a video.</p><dl><div><dt>Duration</dt><dd>{project.settings.durationSeconds ? `${project.settings.durationSeconds}s` : "Not set"}</dd></div><div><dt>Language</dt><dd>{project.settings.language || "Not set"}</dd></div><div><dt>Visual style</dt><dd>{project.settings.visualStyle || "Not set"}</dd></div><div><dt>Aspect ratio</dt><dd>{project.settings.aspectRatio || "Not set"}</dd></div></dl></aside></div>
        <div className="detail-actions">{project.status === "active" ? <button className="quiet-button" disabled={working} onClick={() => void changeStatus("archive")}>Archive project</button> : <button className="quiet-button" disabled={working} onClick={() => void changeStatus("restore")}>Restore project</button>}<span>Revision {project.revision}</span></div>
      </>}
    </section><footer className="workspace-footer"><span>© 2026 VideoGen</span><span>Ideas into stories.</span></footer>
  </main>;
}
