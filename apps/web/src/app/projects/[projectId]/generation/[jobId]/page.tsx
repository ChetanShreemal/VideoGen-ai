"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { generationJobEnvelopeSchema, type GenerationJob } from "@videogen/contracts";
import { apiBaseURL, authClient } from "@/lib/auth-client";
import { WorkspaceShell } from "../../../../workspace-shell";

const stageLabels: Record<GenerationJob["stage"], string> = {
  queued: "Waiting in queue",
  preparing: "Preparing scene plan",
  processing_scenes: "Processing scenes",
  assembling: "Finishing simulation",
  completed: "Simulation complete",
  failed: "Simulation stopped",
};

function statusLabel(status: GenerationJob["status"]): string {
  return status.replaceAll("_", " ");
}

export default function GenerationProgressPage() {
  const { projectId, jobId } = useParams<{ projectId: string; jobId: string }>();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (sessionPending) return;
    if (!session) {
      window.location.replace("/");
      return;
    }

    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      let retryable = true;
      try {
        const response = await fetch(`${apiBaseURL}/jobs/${jobId}`, { credentials: "include", cache: "no-store" });
        if (!response.ok) {
          retryable = response.status !== 404;
          throw new Error(response.status === 404 ? "This generation job was not found." : "Generation status is temporarily unavailable.");
        }
        const result = generationJobEnvelopeSchema.parse(await response.json());
        if (result.data.job.projectId !== projectId) {
          retryable = false;
          throw new Error("This generation job does not belong to this project.");
        }
        if (!current) return;
        setJob(result.data.job);
        setError("");
        setLoading(false);
        if (result.data.job.status === "queued" || result.data.job.status === "running") {
          timer = setTimeout(() => void poll(), 1200);
        }
      } catch (cause) {
        if (!current) return;
        setError(cause instanceof Error ? cause.message : "Generation status is temporarily unavailable.");
        setLoading(false);
        if (retryable) timer = setTimeout(() => void poll(), 3000);
      }
    };

    void poll();
    return () => {
      current = false;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, projectId, refresh, session, sessionPending]);

  const signOut = useCallback(async () => {
    const result = await authClient.signOut();
    if (!result.error) window.location.replace("/");
    else setError("We could not sign you out. Try again.");
  }, []);

  const completeCount = job?.scenes.filter((scene) => scene.status === "completed").length ?? 0;
  const runningCount = job?.scenes.filter((scene) => scene.status === "running").length ?? 0;
  const queuedCount = job?.scenes.filter((scene) => scene.status === "queued").length ?? 0;

  return <WorkspaceShell name={session?.user.name || "Creator"} email={session?.user.email || ""} active="generation" projectId={projectId} generationHref={`/projects/${projectId}/generation/${jobId}`} onSignOut={() => void signOut()}>
    <main className="workspace-page">
      <section className="project-detail generation-page">
        <div className="generation-heading">
          <div><p className="eyebrow">SCENE GENERATION · STEP 4</p><h1>{job?.status === "completed" ? "Generation simulation complete" : job?.status === "failed" ? "Generation run stopped" : "Video generation in progress"}</h1><p className="form-subtitle">{job ? `${completeCount} of ${job.scenes.length} scenes processed for project ${job.projectId.slice(-6).toUpperCase()}.` : "Connecting to the generation job…"}</p></div>
          {job && <span className={`generation-status ${job.status}`}><span aria-hidden="true" />{statusLabel(job.status)}</span>}
        </div>

        <nav className="generation-stepper" aria-label="Creation steps">
          <span className="complete"><span>01</span> Idea &amp; setup</span><span className="step-divider" />
          <Link href={`/projects/${projectId}#storyboard`} className="complete"><span>02</span> Storyboard</Link><span className="step-divider" />
          <span className="current" aria-current="step"><span>03</span> Scene generation</span><span className="step-divider" />
          <span className="upcoming"><span>04</span> Preview &amp; review</span>
        </nav>

        <div className="generation-mode-note generation-disclosure"><span className="material-symbols-outlined" aria-hidden="true">info</span><span><strong>Development simulation only.</strong> The progress is persisted and real, but this run does not generate video files or create a preview asset.</span></div>

        {error && <div className="form-feedback error generation-error" role="alert"><span>{error}</span><button className="quiet-button" type="button" onClick={() => { setLoading(true); setRefresh((value) => value + 1); }}>Retry status check</button></div>}
        {loading && !job ? <div className="detail-panel generation-loading" role="status">Loading generation status…</div> : job ? <>
          <div className="generation-summary-row">
            <article className="generation-summary-card"><span className="material-symbols-outlined complete-icon" aria-hidden="true">check_circle</span><strong>{completeCount} processed</strong><small>Scene steps simulated</small></article>
            <article className="generation-summary-card"><span className="material-symbols-outlined running-icon" aria-hidden="true">sync</span><strong>{runningCount} in progress</strong><small>Currently active</small></article>
            <article className="generation-summary-card"><span className="material-symbols-outlined queued-icon" aria-hidden="true">hourglass_top</span><strong>{queuedCount} queued</strong><small>Waiting their turn</small></article>
          </div>

          <div className="generation-workbench">
            <section className="detail-panel generation-timeline" aria-labelledby="generation-timeline-title">
              <div className="generation-panel-heading"><div><p className="eyebrow">JOB TIMELINE</p><h2 id="generation-timeline-title">Scene generation</h2></div><span className="generation-mono">{job.scenes.length} SCENES</span></div>
              <div className="generation-progress-block"><div className="generation-progress-copy"><span>{stageLabels[job.stage]}</span><strong>{job.progressPercent}%</strong></div><div className="generation-progress-track" role="progressbar" aria-label="Generation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progressPercent}><span style={{ width: `${job.progressPercent}%` }} /></div></div>
              <ol className="generation-scene-list">
                {job.scenes.map((scene, index) => <li className={`generation-scene ${scene.status}`} key={scene.sceneId}>
                  <div className="generation-scene-index">{String(index + 1).padStart(2, "0")}</div>
                  <div className="generation-scene-copy"><div className="generation-scene-title"><h3>{scene.title}</h3><span className={`generation-status ${scene.status}`}><span aria-hidden="true" />{statusLabel(scene.status)}</span></div><div className="generation-scene-meter"><span style={{ width: `${scene.progressPercent}%` }} /></div></div>
                  <span className="generation-mono generation-percent">{scene.progressPercent}%</span>
                </li>)}
              </ol>
            </section>

            <aside className="detail-panel generation-inspector" aria-label="Generation details">
              <div><p className="eyebrow">RUN INSPECTOR</p><h2>{job.status === "failed" ? "Run needs attention" : "Job details"}</h2></div>
              <div className="generation-inspector-callout"><span className="material-symbols-outlined" aria-hidden="true">{job.status === "completed" ? "task_alt" : job.status === "failed" ? "error" : "info"}</span><div><strong>{stageLabels[job.stage]}</strong><p>{job.status === "completed" ? "The simulated scene steps finished. There is no video asset to preview or download." : job.status === "failed" ? (job.error?.message ?? "The simulation stopped before all scene steps completed.") : "Scene progress is updating automatically while this job is active."}</p></div></div>
              <dl className="generation-metadata"><div><dt>Storyboard</dt><dd>Version {job.storyboardVersion}</dd></div><div><dt>Provider</dt><dd>Mock · simulation</dd></div><div><dt>Job ID</dt><dd className="generation-mono">{job.id.slice(-10).toUpperCase()}</dd></div><div><dt>Started</dt><dd>{job.startedAt ? new Date(job.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Queued"}</dd></div></dl>
              <div className="generation-inspector-actions"><Link className="quiet-button" href={`/projects/${projectId}#storyboard`}>Review storyboard</Link><Link className="quiet-button" href={`/projects/${projectId}#generation`}>Back to project</Link></div>
            </aside>
          </div>

          <div className="generation-footer"><div><span className="eyebrow">RUN STATUS</span><strong>{job.progressPercent}% · {stageLabels[job.stage]}</strong></div><div className="generation-footer-actions"><button className="quiet-button" type="button" disabled title="Video preview is unavailable for a simulation">No video preview</button><Link className="primary-button" href={`/projects/${projectId}#generation`}>Back to project<span aria-hidden="true">→</span></Link></div></div>
        </> : null}
      </section>
      <footer className="workspace-footer"><span>© 2026 VideoGen</span><span>Ideas into stories.</span></footer>
    </main>
  </WorkspaceShell>;
}
