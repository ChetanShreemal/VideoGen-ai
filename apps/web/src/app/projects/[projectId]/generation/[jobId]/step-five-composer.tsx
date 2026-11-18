"use client";

import { useEffect, useState } from "react";
import {
  projectResponseEnvelopeSchema,
  storyboardListEnvelopeSchema,
  type ProjectResponse,
  type StoryboardResponse,
} from "@videogen/contracts";
import { apiBaseURL } from "@/lib/auth-client";
import { LocalRenderPanel } from "../../local-render-panel";

export function StepFiveComposer({ projectId, storyboardVersion }: { projectId: string; storyboardVersion: number }) {
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [storyboard, setStoryboard] = useState<StoryboardResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError("");
    setProject(null);
    setStoryboard(null);
    void Promise.all([
      fetch(`${apiBaseURL}/projects/${projectId}`, { credentials: "include", cache: "no-store", signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error("Project details could not be loaded.");
        return projectResponseEnvelopeSchema.parse(await response.json()).data.project;
      }),
      fetch(`${apiBaseURL}/projects/${projectId}/storyboards`, { credentials: "include", cache: "no-store", signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error("Storyboard versions could not be loaded.");
        return storyboardListEnvelopeSchema.parse(await response.json()).data.items;
      }),
    ]).then(([loadedProject, storyboards]) => {
      if (!current) return;
      setProject(loadedProject);
      setStoryboard(storyboards.find((item) => item.version === storyboardVersion) ?? null);
    }).catch((cause) => {
      if (current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Step 5 could not be loaded.");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [projectId, storyboardVersion]);

  if (loading) return <section className="detail-panel local-render-panel" id="step-five-composer" aria-labelledby="step-five-heading" aria-busy="true"><div><p className="eyebrow">VIDEO COMPOSITION · STEP 5</p><h2 id="step-five-heading">Preparing your composition workspace</h2><p className="detail-copy">Loading the approved storyboard and saved media…</p></div></section>;
  if (error || !project || !storyboard) return <section className="detail-panel local-render-panel" id="step-five-composer" aria-labelledby="step-five-heading"><div><p className="eyebrow">VIDEO COMPOSITION · STEP 5</p><h2 id="step-five-heading">Composition workspace unavailable</h2><p className="form-feedback error" role="alert">{error || `Approved storyboard version ${storyboardVersion} could not be found.`}</p></div></section>;

  return <LocalRenderPanel
    key={`${projectId}:${storyboard.id}:${storyboard.version}`}
    projectId={projectId}
    projectTitle={project.title}
    active={project.status === "active"}
    storyboard={storyboard}
    mediaRevision={0}
    narrationVolume={Math.round((project.settings.audioMix?.narrationVolume ?? 1) * 100)}
    musicVolume={Math.round((project.settings.audioMix?.musicVolume ?? 0.2) * 100)}
    musicEnabled={project.settings.audioMix?.musicEnabled ?? false}
    onExportSaved={() => undefined}
  />;
}
