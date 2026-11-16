"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  projectResponseEnvelopeSchema,
  createGenerationJobResponseSchema,
  storyboardEnvelopeSchema,
  storyboardListEnvelopeSchema,
  type StoryboardResponse,
  type StoryboardContent,
  type ProjectResponse,
  updateProjectRequestSchema,
} from "@videogen/contracts";
import { apiBaseURL, authClient } from "@/lib/auth-client";
import { WorkspaceShell } from "../../workspace-shell";
import { ReferenceAssetsPanel } from "./reference-assets-panel";
import { NarrationAssetsPanel } from "./narration-assets-panel";
import { LocalRenderPanel } from "./local-render-panel";
import { ProjectExportsPanel } from "./project-exports-panel";

export default function ProjectDetailsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const router = useRouter();
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [narrationVolume, setNarrationVolume] = useState(100);
  const [musicVolume, setMusicVolume] = useState(20);
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [voiceName, setVoiceName] = useState("Kore");
  const [voicePreviewName, setVoicePreviewName] = useState("");
  const [voicePreviewUrl, setVoicePreviewUrl] = useState("");
  const [voicePreviewAudio, setVoicePreviewAudio] = useState<Blob | null>(null);
  const [mediaRevision, setMediaRevision] = useState(0);
  const [exportsRevision, setExportsRevision] = useState(0);
  const [voiceGenerating, setVoiceGenerating] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [storyboards, setStoryboards] = useState<StoryboardResponse[]>([]);
  const [storyboardContent, setStoryboardContent] = useState<StoryboardContent | null>(null);
  const [storyboardLoading, setStoryboardLoading] = useState(false);
  const [generationCreating, setGenerationCreating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const voiceRequestSequence = useRef(0);
  const voicePreviewController = useRef<AbortController | null>(null);
  const voiceStoryboardKey = storyboards[0] ? `${storyboards[0].id}:${JSON.stringify(storyboards[0].content)}` : "";
  const voiceContextRef = useRef({ projectId, storyboardKey: voiceStoryboardKey });
  voiceContextRef.current = { projectId, storyboardKey: voiceStoryboardKey };

  useEffect(() => () => { if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl); }, [voicePreviewUrl]);

  useEffect(() => {
    voiceRequestSequence.current += 1;
    voicePreviewController.current?.abort();
    voicePreviewController.current = null;
    setVoiceGenerating(false);
    setVoicePreviewUrl("");
    setVoicePreviewAudio(null);
    setVoicePreviewName("");
    setVoiceError("");
    setMessage("");
  }, [projectId, voiceStoryboardKey]);

  useEffect(() => () => {
    voiceRequestSequence.current += 1;
    voicePreviewController.current?.abort();
  }, []);

  useEffect(() => {
    if (sessionPending) return;
    if (!session) {
      window.location.replace("/");
      return;
    }
    let current = true;
    setLoading(true);
    setStoryboards([]);
    setStoryboardContent(null);
    setVoicePreviewUrl("");
    setVoicePreviewAudio(null);
    setVoicePreviewName("");
    setVoiceError("");
    void fetch(`${apiBaseURL}/projects/${projectId}`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Project unavailable");
        const result = projectResponseEnvelopeSchema.parse(await response.json());
        if (current) {
          setProject(result.data.project);
          setTitle(result.data.project.title);
          setTopic(result.data.project.topic ?? "");
          setNarrationVolume(Math.round((result.data.project.settings.audioMix?.narrationVolume ?? 1) * 100));
          setMusicVolume(Math.round((result.data.project.settings.audioMix?.musicVolume ?? 0.2) * 100));
          setMusicEnabled(result.data.project.settings.audioMix?.musicEnabled ?? false);
          setStoryboardLoading(true);
          void fetch(`${apiBaseURL}/projects/${projectId}/storyboards`, { credentials: "include", cache: "no-store" })
            .then(async (storyboardResponse) => {
              if (!storyboardResponse.ok) throw new Error("Storyboard unavailable");
              const payload = storyboardListEnvelopeSchema.parse(await storyboardResponse.json());
              if (current) {
                setStoryboards(payload.data.items);
                const latest = payload.data.items[0];
                setStoryboardContent(latest?.content ?? null);
              }
            })
            .catch(() => { if (current) setError("Storyboard details could not be loaded."); })
            .finally(() => { if (current) setStoryboardLoading(false); });
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
    const parsed = updateProjectRequestSchema.safeParse({ expectedRevision: project?.revision, title, topic: topic.trim() || null });
    if (!parsed.success) { setError("Add a title up to 120 characters and a topic up to 2,000 characters."); return; }
    setWorking(true);
    try {
      const response = await fetch(`${apiBaseURL}/projects/${projectId}`, {
        method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      if (response.status === 409) {
        setError("This project changed since you opened it. Reload to get the latest version before saving.");
        return;
      }
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

  async function saveAudioMix() {
    if (!project) return;
    setWorking(true); setError(""); setMessage("");
    const parsed = updateProjectRequestSchema.safeParse({
      expectedRevision: project.revision,
      settings: {
        ...project.settings,
        audioMix: {
          narrationVolume: narrationVolume / 100,
          musicVolume: musicVolume / 100,
          musicEnabled,
        },
      },
    });
    if (!parsed.success) {
      setError("Audio settings are invalid. Review the volume levels and try again.");
      setWorking(false);
      return;
    }
    try {
      const response = await fetch(`${apiBaseURL}/projects/${projectId}`, {
        method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      if (response.status === 409) {
        setError("This project changed since you opened it. Reload to get the latest settings before saving.");
        return;
      }
      if (!response.ok) {
        setError(`Audio preferences could not be saved (HTTP ${response.status}). Try again.`);
        return;
      }
      const result = projectResponseEnvelopeSchema.parse(await response.json());
      setProject(result.data.project);
      setMessage("Audio preferences saved.");
    } catch (cause) {
      console.error("Audio preferences save failed.", cause);
      setError("Audio preferences could not be saved because the API could not be reached. Check the API connection and try again.");
    } finally {
      setWorking(false);
    }
  }

  const latestStoryboard = storyboards[0] ?? null;
  const storyboardReadOnly = latestStoryboard?.status === "approved" || project?.status !== "active";
  const canCreateStoryboardVersion = latestStoryboard?.status === "approved" && project?.status === "active";

  async function generateVoicePreview() {
    if (!project || !latestStoryboard) return;
    voicePreviewController.current?.abort();
    const controller = new AbortController();
    voicePreviewController.current = controller;
    const requestSequence = ++voiceRequestSequence.current;
    const requestProjectId = projectId;
    const requestStoryboardKey = voiceContextRef.current.storyboardKey;
    const requestIsCurrent = () => voiceRequestSequence.current === requestSequence
      && voiceContextRef.current.projectId === requestProjectId
      && voiceContextRef.current.storyboardKey === requestStoryboardKey;
    setVoiceGenerating(true);
    setVoiceError("");
    try {
      const response = await fetch(`${apiBaseURL}/projects/${projectId}/storyboards/${latestStoryboard.id}/narration-audio`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voiceName }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        const retrySeconds = Number(response.headers.get("retry-after"));
        const waitMessage = response.status === 429 && Number.isFinite(retrySeconds) && retrySeconds > 0
          ? retrySeconds < 60
            ? ` Try again in about ${retrySeconds} second${retrySeconds === 1 ? "" : "s"}.`
            : ` Try again in about ${Math.ceil(retrySeconds / 60)} minute${Math.ceil(retrySeconds / 60) === 1 ? "" : "s"}.`
          : "";
        throw new Error(`${payload?.error?.message || "Narration could not be generated. Try again."}${waitMessage}`);
      }
      const audio = await response.blob();
      if (audio.type !== "audio/wav" || audio.size < 44) throw new Error("The voice provider returned an audio file the browser could not play.");
      if (!requestIsCurrent()) return;
      setVoicePreviewUrl(URL.createObjectURL(audio));
      setVoicePreviewAudio(audio);
      setVoicePreviewName(voiceName);
      setMessage(`Voice preview ready for storyboard version ${latestStoryboard.version}.`);
    } catch (cause) {
      if (!requestIsCurrent() || controller.signal.aborted) return;
      setVoiceError(cause instanceof Error ? cause.message : "Narration could not be generated. Try again.");
    } finally {
      if (requestIsCurrent()) {
        voicePreviewController.current = null;
        setVoiceGenerating(false);
      }
    }
  }

  const hasSavedNarration = Boolean(latestStoryboard && storyboardContent && JSON.stringify(latestStoryboard.content) === JSON.stringify(storyboardContent));

  function updateScene(index: number, field: "title" | "narration" | "visualDescription" | "caption" | "transition" | "durationSeconds", value: string) {
    setStoryboardContent((current) => current ? ({ ...current, scenes: current.scenes.map((scene, sceneIndex) => sceneIndex === index ? { ...scene, [field]: field === "durationSeconds" ? Number(value) : value } : scene) }) : current);
  }

  function moveScene(index: number, offset: number) {
    setStoryboardContent((current) => {
      if (!current) return current;
      const destination = index + offset;
      if (destination < 0 || destination >= current.scenes.length) return current;
      const scenes = [...current.scenes];
      [scenes[index], scenes[destination]] = [scenes[destination]!, scenes[index]!];
      return { ...current, scenes };
    });
  }

  async function saveStoryboard(asNewVersion = false) {
    if (!project || !storyboardContent) return;
    setWorking(true); setError(""); setMessage("");
    try {
      const url = asNewVersion || !latestStoryboard ? `${apiBaseURL}/projects/${projectId}/storyboards` : `${apiBaseURL}/projects/${projectId}/storyboards/${latestStoryboard.id}`;
      const body = asNewVersion || !latestStoryboard ? { content: storyboardContent } : { expectedRevision: latestStoryboard.revision, content: storyboardContent };
      const response = await fetch(url, { method: asNewVersion || !latestStoryboard ? "POST" : "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (response.status === 409) throw new Error("This storyboard changed since you opened it. Reload before saving.");
      if (!response.ok) throw new Error("Storyboard could not be saved.");
      const result = storyboardEnvelopeSchema.parse(await response.json());
      setStoryboards((current) => [result.data.storyboard, ...current.filter((item) => item.id !== result.data.storyboard.id)]);
      setStoryboardContent(result.data.storyboard.content);
      setMessage(`Storyboard version ${result.data.storyboard.version} saved.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Storyboard could not be saved."); }
    finally { setWorking(false); }
  }

  async function approveStoryboard() {
    if (!latestStoryboard) return;
    setWorking(true); setError(""); setMessage("");
    try {
      const response = await fetch(`${apiBaseURL}/projects/${projectId}/storyboards/${latestStoryboard.id}/approve`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: latestStoryboard.revision }) });
      if (!response.ok) throw new Error("Storyboard could not be approved.");
      const result = storyboardEnvelopeSchema.parse(await response.json());
      setStoryboards((current) => [result.data.storyboard, ...current.filter((item) => item.id !== result.data.storyboard.id)]);
      setMessage("Storyboard approved and locked. Create a new version to make more edits.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Storyboard could not be approved."); }
    finally { setWorking(false); }
  }

  async function startGeneration() {
    if (!latestStoryboard || latestStoryboard.status !== "approved" || project?.status !== "active") return;
    setGenerationCreating(true);
    setGenerationError("");
    const storageKey = `videogen:generation-idempotency:${projectId}:${latestStoryboard.id}`;
    try {
      const idempotencyKey = localStorage.getItem(storageKey) ?? crypto.randomUUID();
      localStorage.setItem(storageKey, idempotencyKey);
      const response = await fetch(`${apiBaseURL}/projects/${projectId}/generations`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ storyboardId: latestStoryboard.id }),
      });
      if (!response.ok) throw new Error(response.status === 503 ? "Generation is temporarily unavailable. Try again shortly." : "The generation run could not be started. Please retry.");
      const result = createGenerationJobResponseSchema.parse(await response.json());
      localStorage.removeItem(storageKey);
      router.push(`/projects/${projectId}/generation/${result.data.jobId}`);
    } catch (cause) {
      setGenerationError(cause instanceof Error ? cause.message : "The generation run could not be started. Please retry.");
    } finally {
      setGenerationCreating(false);
    }
  }

  async function signOut() {
    setWorking(true);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign out failed.");
      window.location.replace("/");
    } catch {
      setError("We could not sign you out. Try again.");
      setWorking(false);
    }
  }

  return <WorkspaceShell name={session?.user.name || "Creator"} email={session?.user.email || ""} active="storyboard" projectId={projectId} onSignOut={() => void signOut()} signingOut={working}>
  <main className="workspace-page">
    <section className="project-detail">
      {loading ? <div className="project-empty">Loading project…</div> : !project ? <div className="project-empty"><h1>Project unavailable</h1><p>{error}</p><Link className="quiet-button" href="/">Back to projects</Link></div> : <>
        <div className="detail-heading"><div><p className="eyebrow">PROJECT WORKSPACE</p><h1>{project.title}</h1><p className="form-subtitle">Created {new Date(project.createdAt).toLocaleDateString()} · Last updated {new Date(project.updatedAt).toLocaleDateString()}</p></div><span className={`status-pill ${project.status}`}>{project.status}</span></div>
        {error && <p className="form-feedback error" role="alert">{error}</p>}{message && <p className="form-feedback info" role="status">{message}</p>}
        <div className="detail-layout"><form className="detail-panel" onSubmit={save}><div><p className="eyebrow">PROJECT DETAILS</p><h2>Shape the starting point</h2><p className="detail-copy">These details stay with your project and can be changed as your story develops.</p></div><label className="field"><span>Project title</span><input required maxLength={120} disabled={project.status !== "active" || working} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="field"><span>Video topic</span><textarea maxLength={2000} disabled={project.status !== "active" || working} value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Describe the idea behind this video" /></label>{project.status === "active" && <button className="primary-button" disabled={working} type="submit">{working ? "Saving…" : "Save changes"}<span aria-hidden="true">→</span></button>}</form>
          <aside className="detail-panel project-settings-panel"><p className="eyebrow">GENERATION SETTINGS</p><h2>Ready when you are</h2><p className="detail-copy">Set these up in a future step when you turn this idea into a video.</p><dl><div><dt>Duration</dt><dd>{project.settings.durationSeconds ? `${project.settings.durationSeconds}s` : "Not set"}</dd></div><div><dt>Language</dt><dd>{project.settings.language || "Not set"}</dd></div><div><dt>Visual style</dt><dd>{project.settings.visualStyle || "Not set"}</dd></div><div><dt>Aspect ratio</dt><dd>{project.settings.aspectRatio || "Not set"}</dd></div></dl></aside></div>
          <ReferenceAssetsPanel key={projectId} projectId={projectId} active={project.status === "active"} onMediaChanged={() => setMediaRevision((revision) => revision + 1)} />
        <section className="detail-panel audio-panel" id="audio-settings" aria-labelledby="audio-settings-title">
          <div><p className="eyebrow">VOICE & AUDIO · STEP 3</p><h2 id="audio-settings-title">Voice & audio</h2><p className="detail-copy">Preview a spoken version of the latest saved storyboard, then set narration and background music levels.</p></div>
          <label className="field"><span>Narrator voice</span><select value={voiceName} disabled={project.status !== "active" || voiceGenerating || !latestStoryboard} onChange={(event) => setVoiceName(event.target.value)}><option value="Kore">Kore · Warm</option><option value="Puck">Puck · Conversational</option><option value="Charon">Charon · Deep</option><option value="Aoede">Aoede · Expressive</option><option value="Fenrir">Fenrir · Bright</option><option value="Zephyr">Zephyr · Light</option></select></label>
          <div className="voice-preview-controls"><button className="primary-button" disabled={project.status !== "active" || voiceGenerating || !latestStoryboard || !hasSavedNarration} onClick={() => void generateVoicePreview()} type="button">{voiceGenerating ? "Generating voice…" : voicePreviewUrl ? "Regenerate voice preview" : "Generate voice preview"}<span aria-hidden="true">→</span></button>{!latestStoryboard && <small>Save a storyboard first to generate narration.</small>}{latestStoryboard && !hasSavedNarration && <small>Save your storyboard changes before generating narration.</small>}</div>
          {voiceError && <p className="form-feedback error voice-feedback" role="alert">{voiceError}</p>}
          {voicePreviewUrl && <div className="voice-preview"><span className="eyebrow">PREVIEW · VERSION {latestStoryboard?.version}</span><audio controls preload="metadata" src={voicePreviewUrl}>Your browser does not support audio playback.</audio></div>}
          <NarrationAssetsPanel key={projectId} projectId={projectId} active={project.status === "active"} storyboardId={latestStoryboard?.id} audio={voicePreviewAudio} voiceName={voicePreviewName || voiceName} onMediaChanged={() => setMediaRevision((revision) => revision + 1)} />
          <p className="voice-privacy-note">Free Gemini tier is subject to usage limits. Google may use free-tier prompts and generated responses to improve its products; don’t include sensitive narration.</p>
          <label className="field audio-range"><span>Narration volume <output>{narrationVolume}%</output></span><input aria-label="Narration volume" type="range" min="0" max="100" step="5" disabled={project.status !== "active" || working} value={narrationVolume} onChange={(event) => setNarrationVolume(Number(event.target.value))} /></label>
          <label className="audio-toggle"><input type="checkbox" checked={musicEnabled} disabled={project.status !== "active" || working} onChange={(event) => setMusicEnabled(event.target.checked)} /><span>Include background music</span><small>Off by default. Select an audio track from your device in the render section.</small></label>
          <label className="field audio-range"><span>Music volume <output>{musicVolume}%</output></span><input aria-label="Music volume" type="range" min="0" max="100" step="5" disabled={!musicEnabled || project.status !== "active" || working} value={musicVolume} onChange={(event) => setMusicVolume(Number(event.target.value))} /></label>
          {project.status === "active" && <button className="primary-button" disabled={working} onClick={() => void saveAudioMix()} type="button">{working ? "Saving…" : "Save audio preferences"}<span aria-hidden="true">→</span></button>}
        </section>
        <section className="storyboard-panel detail-panel" id="storyboard">
          <div className="storyboard-heading"><div><p className="eyebrow">CREATIVE PLAN · STEP 2</p><h2>Storyboard</h2><p className="detail-copy">Shape the story in ordered scenes. Nothing is generated from this draft.</p></div>{latestStoryboard && <span className={`status-pill ${latestStoryboard.status}`}>Version {latestStoryboard.version} · {latestStoryboard.status}</span>}</div>
          {storyboardLoading ? <p className="detail-copy">Loading storyboard…</p> : !storyboardContent ? <div className="storyboard-empty"><p>Turn your idea into a scene-by-scene plan.</p><button className="primary-button" disabled={working || !project.topic} onClick={() => { setStoryboardContent({ hook: project.topic ?? "", closing: "", scenes: [{ id: crypto.randomUUID(), title: "Opening scene", narration: project.topic ?? "", visualDescription: "Describe what the viewer sees", caption: "", durationSeconds: 8, transition: "Cut", characterReferences: [] }] }); }}>Start storyboard<span aria-hidden="true">→</span></button>{!project.topic && <small>Add a video topic above before starting.</small>}</div> : <>
            <label className="field"><span>Opening hook</span><textarea disabled={storyboardReadOnly || working} maxLength={2000} value={storyboardContent.hook} onChange={(event) => setStoryboardContent((current) => current ? { ...current, hook: event.target.value } : current)} /></label>
            <div className="scene-list">{storyboardContent.scenes.map((scene, index) => <article className="scene-card" key={scene.id}>
              <header><div><span className="scene-number">SCENE {String(index + 1).padStart(2, "0")}</span><h3>{scene.title || "Untitled scene"}</h3></div><div className="scene-controls"><button type="button" aria-label={`Move scene ${index + 1} up`} disabled={storyboardReadOnly || index === 0 || working} onClick={() => moveScene(index, -1)}>↑</button><button type="button" aria-label={`Move scene ${index + 1} down`} disabled={storyboardReadOnly || index === storyboardContent.scenes.length - 1 || working} onClick={() => moveScene(index, 1)}>↓</button><button type="button" aria-label={`Remove scene ${index + 1}`} disabled={storyboardReadOnly || storyboardContent.scenes.length === 1 || working} onClick={() => setStoryboardContent((current) => current ? { ...current, scenes: current.scenes.filter((item) => item.id !== scene.id) } : current)}>×</button></div></header>
              <div className="scene-fields"><label className="field"><span>Scene title</span><input disabled={storyboardReadOnly || working} maxLength={120} value={scene.title} onChange={(event) => updateScene(index, "title", event.target.value)} /></label><label className="field"><span>Duration (seconds)</span><input type="number" min={1} max={600} disabled={storyboardReadOnly || working} value={scene.durationSeconds} onChange={(event) => updateScene(index, "durationSeconds", event.target.value)} /></label><label className="field"><span>Narration</span><textarea disabled={storyboardReadOnly || working} maxLength={4000} value={scene.narration} onChange={(event) => updateScene(index, "narration", event.target.value)} /></label><label className="field"><span>Visual description</span><textarea disabled={storyboardReadOnly || working} maxLength={2000} value={scene.visualDescription} onChange={(event) => updateScene(index, "visualDescription", event.target.value)} /></label><label className="field"><span>On-screen caption</span><input disabled={storyboardReadOnly || working} maxLength={500} value={scene.caption} onChange={(event) => updateScene(index, "caption", event.target.value)} /></label><label className="field"><span>Transition</span><input disabled={storyboardReadOnly || working} maxLength={80} value={scene.transition} onChange={(event) => updateScene(index, "transition", event.target.value)} /></label></div>
            </article>)}</div>
            <button className="quiet-button scene-add" disabled={storyboardReadOnly || working || storyboardContent.scenes.length >= 50} onClick={() => setStoryboardContent((current) => current ? { ...current, scenes: [...current.scenes, { id: crypto.randomUUID(), title: `Scene ${current.scenes.length + 1}`, narration: "", visualDescription: "", caption: "", durationSeconds: 8, transition: "Cut", characterReferences: [] }] } : current)}>＋ Add scene</button>
            <label className="field storyboard-closing"><span>Closing / call to action</span><textarea disabled={storyboardReadOnly || working} maxLength={2000} value={storyboardContent.closing} onChange={(event) => setStoryboardContent((current) => current ? { ...current, closing: event.target.value } : current)} /></label>
            <div className="storyboard-footer"><span>{storyboardContent.scenes.reduce((total, scene) => total + (Number(scene.durationSeconds) || 0), 0)} sec total · {storyboardContent.scenes.reduce((total, scene) => total + scene.narration.trim().split(/\s+/).filter(Boolean).length, 0)} narration words</span><div>{canCreateStoryboardVersion ? <button className="quiet-button" disabled={working} onClick={() => void saveStoryboard(true)}>Create new version</button> : storyboardReadOnly ? null : latestStoryboard ? <><button className="quiet-button" disabled={working} onClick={() => void saveStoryboard()}>Save draft</button><button className="primary-button" disabled={working} onClick={() => void approveStoryboard()}>Approve storyboard<span aria-hidden="true">→</span></button></> : <button className="primary-button" disabled={working} onClick={() => void saveStoryboard()}>Save storyboard<span aria-hidden="true">→</span></button>}</div></div>
          </>}
        </section>
        <section className="detail-panel generation-launch-panel" id="generation" aria-labelledby="generation-launch-title">
          <div><p className="eyebrow">SCENE GENERATION · STEP 4</p><h2 id="generation-launch-title">Generate your scenes</h2><p className="detail-copy">Start from the approved storyboard. Your run will show live job progress in the generation workbench.</p></div>
          <div className="generation-mode-note"><span className="material-symbols-outlined" aria-hidden="true">info</span><span><strong>Development simulation</strong><br />This run demonstrates the progress flow and does not create video files.</span></div>
          {latestStoryboard?.status === "approved" && project.status === "active" ? <button className="primary-button generation-start-button" disabled={generationCreating || working} onClick={() => void startGeneration()} type="button"><span className="material-symbols-outlined" aria-hidden="true">play_arrow</span>{generationCreating ? "Starting simulation…" : "Run simulated generation"}</button> : <p className="generation-locked-note">{project.status !== "active" ? "Restore this project before starting a generation run." : latestStoryboard ? "Approve the storyboard above before starting a generation run." : "Save and approve a storyboard before starting a generation run."}</p>}
          {generationError && <p className="form-feedback error" role="alert">{generationError}</p>}
        </section>
        <LocalRenderPanel key={`${projectId}:${latestStoryboard?.id ?? "none"}:${latestStoryboard?.version ?? 0}`} projectId={projectId} projectTitle={project.title} active={project.status === "active"} storyboard={latestStoryboard ?? undefined} mediaRevision={mediaRevision} narrationVolume={narrationVolume} musicVolume={musicVolume} musicEnabled={musicEnabled} onExportSaved={() => setExportsRevision((revision) => revision + 1)} />
        <ProjectExportsPanel projectId={projectId} revision={exportsRevision} />
        <div className="detail-actions">{project.status === "active" ? <button className="quiet-button" disabled={working} onClick={() => void changeStatus("archive")}>Archive project</button> : <button className="quiet-button" disabled={working} onClick={() => void changeStatus("restore")}>Restore project</button>}<span>Revision {project.revision}</span></div>
      </>}
    </section><footer className="workspace-footer"><span>© 2026 VideoGen</span><span>Ideas into stories.</span></footer>
  </main>
  </WorkspaceShell>;
}
