"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  createProjectResponseSchema,
  listProjectsResponseSchema,
  type ProjectResponse,
} from "@videogen/contracts";
import { apiBaseURL } from "@/lib/auth-client";

type ProjectStatus = "active" | "archived";

export function ProjectsWorkspace({
  name,
  email,
  onSignOut,
  signingOut,
}: {
  name: string;
  email: string;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");

  const loadProjects = useCallback(async (nextStatus: ProjectStatus, nextCursor?: string, append = false) => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ status: nextStatus, limit: "20" });
      if (nextCursor) query.set("cursor", nextCursor);
      const response = await fetch(`${apiBaseURL}/projects?${query}`, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("Project list request failed.");
      const result = listProjectsResponseSchema.parse(await response.json());
      setProjects((current) => append ? [...current, ...result.data.items] : result.data.items);
      setCursor(result.data.nextCursor);
    } catch {
      setError("Projects could not be loaded. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProjects(status); }, [loadProjects, status]);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseURL}/projects`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, ...(topic.trim() ? { topic: topic.trim() } : {}) }),
      });
      if (!response.ok) throw new Error("Project creation failed.");
      createProjectResponseSchema.parse(await response.json());
      setTitle("");
      setTopic("");
      if (status !== "active") setStatus("active");
      else await loadProjects("active");
    } catch {
      setError("The project could not be created. Check the details and try again.");
    } finally {
      setWorking(false);
    }
  }

  async function changeProjectStatus(project: ProjectResponse, action: "archive" | "restore") {
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseURL}/projects/${project.id}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Project status change failed.");
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch {
      setError(`The project could not be ${action === "archive" ? "archived" : "restored"}. Try again.`);
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="workspace-page">
      <header className="workspace-topbar">
        <a className="brand" href="/" aria-label="VideoGen home"><span className="brand-mark" aria-hidden="true">V</span><span>VideoGen</span></a>
        <div className="workspace-account"><span><strong>{name || email}</strong><small>{email}</small></span><button className="quiet-button" onClick={onSignOut} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button></div>
      </header>
      <section className="workspace-main">
        <div className="workspace-heading">
          <div><p className="eyebrow">YOUR CREATIVE STUDIO</p><h1>Projects</h1><p className="form-subtitle">Pick up a story or start something new.</p></div>
          <div className="project-tabs" role="tablist" aria-label="Project status">
            <button role="tab" aria-selected={status === "active"} className={status === "active" ? "selected" : ""} onClick={() => setStatus("active")}>Active</button>
            <button role="tab" aria-selected={status === "archived"} className={status === "archived" ? "selected" : ""} onClick={() => setStatus("archived")}>Archived</button>
          </div>
        </div>

        {status === "active" && <form className="project-create" onSubmit={createProject}>
          <div><p className="eyebrow">NEW PROJECT</p><h2>Start with an idea</h2><p>Give your next video a working title. You can refine it anytime.</p></div>
          <div className="project-create-fields"><label className="sr-only" htmlFor="project-title">Project title</label><input id="project-title" required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. The curious seed" /><label className="sr-only" htmlFor="project-topic">Topic (optional)</label><input id="project-topic" maxLength={2000} value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="What is your video about? (optional)" /><button className="primary-button" disabled={working || !title.trim()} type="submit">{working ? "Creating…" : "Create project"}<span aria-hidden="true">→</span></button></div>
        </form>}

        {error && <p className="form-feedback error" role="alert">{error}</p>}
        <div className="project-list-heading"><h2>{status === "active" ? "Your projects" : "Archive"}</h2><span>{loading ? "Loading…" : `${projects.length}${cursor ? "+" : ""} ${projects.length === 1 ? "project" : "projects"}`}</span></div>
        {loading && projects.length === 0 ? <div className="project-empty">Loading your projects…</div> : projects.length === 0 ? <div className="project-empty"><span className="empty-mark" aria-hidden="true">✳</span><h3>{status === "active" ? "Your next story starts here" : "Nothing archived"}</h3><p>{status === "active" ? "Create a project above and shape your idea into a video." : "Projects you archive will be kept here so you can restore them later."}</p></div> : <div className="project-grid">{projects.map((project) => <article className="project-card" key={project.id}>
          <Link className="project-card-link" href={`/projects/${project.id}`}><div className="project-card-art"><span>VG</span><i aria-hidden="true">↗</i></div><div className="project-card-info"><span className="project-status">{project.status}</span><h3>{project.title}</h3><p>{project.topic || "No description yet"}</p><small>Updated {new Date(project.updatedAt).toLocaleDateString()}</small></div></Link>
          <div className="project-card-actions">{status === "active" ? <button className="quiet-button" disabled={working} onClick={() => void changeProjectStatus(project, "archive")}>Archive</button> : <button className="quiet-button" disabled={working} onClick={() => void changeProjectStatus(project, "restore")}>Restore</button>}</div>
        </article>)}</div>}
        {cursor && <button className="load-more" disabled={loading} onClick={() => void loadProjects(status, cursor, true)}>{loading ? "Loading…" : "Load more"}</button>}
      </section>
      <footer className="workspace-footer"><span>© 2026 VideoGen</span><span>Ideas into stories.</span></footer>
    </main>
  );
}
