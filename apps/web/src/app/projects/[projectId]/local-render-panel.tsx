"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { renderMediaOnWeb } from "@remotion/web-renderer";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, useCurrentFrame } from "remotion";
import {
  assetPreviewResponseSchema,
  projectAssetsResponseSchema,
  projectNarrationAssetsResponseSchema,
  type ProjectAsset,
  type ProjectNarrationAsset,
  type StoryboardResponse,
} from "@videogen/contracts";
import { apiBaseURL } from "@/lib/auth-client";

const fps = 30;
const maxDurationSeconds = 120;
type Format = "landscape" | "portrait" | "square";

const dimensions: Record<Format, { width: number; height: number; label: string }> = {
  landscape: { width: 1280, height: 720, label: "Landscape · 16:9" },
  portrait: { width: 720, height: 1280, label: "Portrait · 9:16" },
  square: { width: 720, height: 720, label: "Square · 1:1" },
};

interface LocalRenderPanelProps {
  projectId: string;
  projectTitle: string;
  active: boolean;
  storyboard?: StoryboardResponse;
}

interface SceneCardProps {
  projectTitle: string;
  number: number;
  total: number;
  title: string;
  description: string;
  caption: string;
  hook: string;
}

function ClosingCard({ projectTitle, closing }: { projectTitle: string; closing: string }) {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "#101316", color: "#f3f1ed", fontFamily: "Roboto, Arial, sans-serif", padding: "8%", justifyContent: "center", gap: 28, opacity: fade }}>
    <span style={{ color: "#f28c28", fontSize: 17, fontWeight: 700, letterSpacing: 3 }}>VIDEOGEN · {projectTitle}</span>
    <h1 style={{ fontSize: 60, lineHeight: 1.1, margin: 0 }}>{closing}</h1>
  </AbsoluteFill>;
}

function SceneCard({ projectTitle, number, total, title, description, caption, hook, referenceImageUrl }: SceneCardProps & { referenceImageUrl?: string }) {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rise = interpolate(frame, [0, 18], [26, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return <AbsoluteFill style={{ background: "#101316", color: "#f3f1ed", fontFamily: "Roboto, Arial, sans-serif", padding: "7%", justifyContent: "space-between", opacity: fade, transform: `translateY(${rise}px)` }}>
    {referenceImageUrl && <><Img src={referenceImageUrl} alt="Selected project reference" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.3 }} /><AbsoluteFill style={{ zIndex: 0, pointerEvents: "none", background: "linear-gradient(90deg, rgba(16,19,22,.96), rgba(16,19,22,.55))" }} /></>}
    <div style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #31363b", paddingBottom: 18 }}>
      <span style={{ color: "#f28c28", fontSize: 17, fontWeight: 700, letterSpacing: 3 }}>VIDEOGEN</span>
      <span style={{ color: "#8f969c", fontSize: 16, letterSpacing: 2 }}>{String(number).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
    </div>
    <div style={{ position: "relative", zIndex: 1, display: "grid", gap: 24, maxWidth: "88%" }}>
      {number === 1 && hook && <p style={{ color: "#f28c28", fontSize: 20, fontWeight: 600, lineHeight: 1.35, margin: 0 }}>{hook}</p>}
      <p style={{ color: "#8f969c", fontSize: 17, letterSpacing: 2, margin: 0, textTransform: "uppercase" }}>{projectTitle}</p>
      <h1 style={{ fontSize: 60, lineHeight: 1.08, margin: 0, fontWeight: 700 }}>{title}</h1>
      {description && <p style={{ color: "#c3c7ca", fontSize: 28, lineHeight: 1.35, margin: 0 }}>{description}</p>}
    </div>
    <div style={{ position: "relative", zIndex: 1, borderLeft: "5px solid #f28c28", padding: "4px 0 4px 20px", minHeight: 34 }}>
      {caption && <p style={{ fontSize: 25, fontWeight: 600, lineHeight: 1.25, margin: 0 }}>{caption}</p>}
    </div>
  </AbsoluteFill>;
}

function StoryboardComposition({ projectTitle, storyboard, referenceImageUrl, narrationUrl }: { projectTitle: string; storyboard: StoryboardResponse["content"]; referenceImageUrl?: string; narrationUrl?: string }) {
  let from = 0;
  const sceneSequences = storyboard.scenes.map((scene, index) => {
    const durationInFrames = Math.max(1, Math.round(scene.durationSeconds * fps));
    const sequenceFrom = from;
    from += durationInFrames;
    return <Sequence key={scene.id} from={sequenceFrom} durationInFrames={durationInFrames}>
      <SceneCard projectTitle={projectTitle} number={index + 1} total={storyboard.scenes.length} title={scene.title} description={scene.visualDescription} caption={scene.caption} hook={storyboard.hook} referenceImageUrl={referenceImageUrl} />
    </Sequence>;
  });
  const closingFrames = storyboard.closing ? 3 * fps : 0;
  if (closingFrames) sceneSequences.push(<Sequence key="closing" from={from} durationInFrames={closingFrames}><ClosingCard projectTitle={projectTitle} closing={storyboard.closing} /></Sequence>);

  return <AbsoluteFill style={{ backgroundColor: "#101316" }}>{sceneSequences}{narrationUrl && <Audio src={narrationUrl} volume={0.9} crossOrigin="anonymous" />}</AbsoluteFill>;
}

export function LocalRenderPanel({ projectId, projectTitle, active, storyboard }: LocalRenderPanelProps) {
  const [format, setFormat] = useState<Format>("landscape");
  const [progress, setProgress] = useState<number | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState("");
  const [referenceImages, setReferenceImages] = useState<ProjectAsset[]>([]);
  const [narrationAssets, setNarrationAssets] = useState<ProjectNarrationAsset[]>([]);
  const [referenceImageId, setReferenceImageId] = useState("");
  const [narrationAssetId, setNarrationAssetId] = useState("");
  const [mediaLoading, setMediaLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const durationSeconds = useMemo(() => storyboard ? storyboard.content.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0) + (storyboard.content.closing ? 3 : 0) : 0, [storyboard]);
  const renderable = Boolean(storyboard && storyboard.status === "approved" && active && durationSeconds > 0 && durationSeconds <= maxDurationSeconds);

  useEffect(() => {
    const controller = new AbortController();
    setReferenceImages([]);
    setNarrationAssets([]);
    setReferenceImageId("");
    setNarrationAssetId("");
    setMediaLoading(true);
    void Promise.all([
      fetch(`${apiBaseURL}/projects/${projectId}/assets`, { credentials: "include", cache: "no-store", signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error("Reference images could not be loaded.");
        return projectAssetsResponseSchema.parse(await response.json()).data.items.filter((asset) => asset.contentType.startsWith("image/"));
      }),
      fetch(`${apiBaseURL}/projects/${projectId}/narration-assets`, { credentials: "include", cache: "no-store", signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error("Saved narration could not be loaded.");
        return projectNarrationAssetsResponseSchema.parse(await response.json()).data.items;
      }),
    ]).then(([images, narration]) => {
      if (controller.signal.aborted) return;
      setReferenceImages(images);
      const matchingNarration = narration.filter((asset) => asset.storyboardVersion === storyboard?.version);
      setNarrationAssets(matchingNarration);
      setNarrationAssetId((current) => current || matchingNarration[0]?.id || "");
    }).catch(() => {
      if (!controller.signal.aborted) setError("Saved media could not be loaded. You can still render without it.");
    }).finally(() => { if (!controller.signal.aborted) setMediaLoading(false); });
    return () => controller.abort();
  }, [projectId, storyboard?.version]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl, projectId, storyboard?.id]);

  async function renderLocally() {
    if (!storyboard || !renderable) return;
    if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
      setError("This browser does not support local MP4 rendering. Use a recent version of Chrome, Edge, Firefox, or Safari.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl("");
    setError("");
    setProgress(0);
    try {
      const [referenceImageUrl, narrationUrl] = await Promise.all([
        referenceImageId ? fetch(`${apiBaseURL}/projects/${projectId}/assets/${referenceImageId}/preview`, { credentials: "include", cache: "no-store" }).then(async (response) => {
          if (!response.ok) throw new Error("The selected reference image preview could not be prepared.");
          return assetPreviewResponseSchema.parse(await response.json()).data.url;
        }) : Promise.resolve(undefined),
        narrationAssetId ? fetch(`${apiBaseURL}/projects/${projectId}/narration-assets/${narrationAssetId}/preview`, { credentials: "include", cache: "no-store" }).then(async (response) => {
          if (!response.ok) throw new Error("The selected narration preview could not be prepared.");
          return assetPreviewResponseSchema.parse(await response.json()).data.url;
        }) : Promise.resolve(undefined),
      ]);
      if (controller.signal.aborted) return;
      const { width, height } = dimensions[format];
      const result = await renderMediaOnWeb({
        composition: {
          id: `storyboard-${storyboard.id}-${format}`,
          component: StoryboardComposition,
          width,
          height,
          fps,
          durationInFrames: Math.round(durationSeconds * fps),
          calculateMetadata: null,
          defaultProps: { projectTitle, storyboard: storyboard.content, referenceImageUrl, narrationUrl },
        },
        inputProps: { projectTitle, storyboard: storyboard.content, referenceImageUrl, narrationUrl },
        container: "mp4",
        videoCodec: "h264",
        licenseKey: "free-license",
        isProduction: process.env.NODE_ENV === "production",
        signal: controller.signal,
        onProgress: ({ progress: nextProgress }) => setProgress(Math.round(nextProgress * 100)),
      });
      if (controller.signal.aborted) return;
      const blob = await result.getBlob();
      if (blob.size === 0) throw new Error("The local render returned an empty file.");
      setVideoUrl(URL.createObjectURL(blob));
      setProgress(100);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The local video could not be rendered. Try again.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (!controller.signal.aborted) setProgress(null);
    }
  }

  const fileName = `videogen-${projectId.slice(-6)}-${format}.mp4`;
  return <section className="detail-panel local-render-panel" aria-labelledby="local-render-title">
    <div><p className="eyebrow">LOCAL VIDEO · STEP 5</p><h2 id="local-render-title">Compose a storyboard video</h2><p className="detail-copy">Render animated scene cards from your approved titles, visual descriptions, hook, captions and closing. Optionally include a saved reference image and narration track. Processing and video content stay in this browser; this first version does not create AI footage.</p></div>
    <label className="field local-render-format"><span>Video format</span><select value={format} disabled={progress !== null} onChange={(event) => setFormat(event.target.value as Format)}>{Object.entries(dimensions).map(([value, item]) => <option value={value} key={value}>{item.label} · {item.width}×{item.height}</option>)}</select></label>
    <p className="local-render-note">Up to {maxDurationSeconds} seconds · 30 fps · MP4/H.264 · keep this tab open while rendering</p>
    <div className="local-render-media-options">
      <label className="field"><span>Reference image <small>(optional)</small></span><select value={referenceImageId} disabled={mediaLoading || progress !== null} onChange={(event) => setReferenceImageId(event.target.value)}><option value="">No reference image</option>{referenceImages.map((asset) => <option value={asset.id} key={asset.id}>{asset.fileName}</option>)}</select></label>
      <label className="field"><span>Saved narration <small>(optional)</small></span><select value={narrationAssetId} disabled={mediaLoading || progress !== null} onChange={(event) => setNarrationAssetId(event.target.value)}><option value="">No narration · silent video</option>{narrationAssets.map((asset) => <option value={asset.id} key={asset.id}>v{asset.storyboardVersion} · {asset.voiceName}</option>)}</select></label>
      {mediaLoading && <small className="detail-copy">Loading this project’s saved media…</small>}
      {!mediaLoading && narrationAssets.length === 0 && <small className="detail-copy">No saved narration for this storyboard version. Generate and save a narration preview above to include audio.</small>}
      <small className="detail-copy">The image is used as a subtle backdrop on each scene. Saved narration plays from the start and is clipped to the video duration.</small>
    </div>
    <p className="local-render-privacy">Remotion receives your IP address, this site’s domain and the render outcome for license accounting. It does not receive storyboard or media content.</p>
    {!storyboard && <p className="generation-locked-note">Save and approve a storyboard to enable local video composition.</p>}
    {storyboard && storyboard.status !== "approved" && <p className="generation-locked-note">Approve the storyboard before composing a video.</p>}
    {storyboard && durationSeconds > maxDurationSeconds && <p className="form-feedback error" role="alert">This storyboard is {durationSeconds} seconds. Shorten it to {maxDurationSeconds} seconds or less for the first local-render version.</p>}
    {error && <p className="form-feedback error" role="alert">{error}</p>}
    {progress !== null ? <div className="local-render-progress" role="status" aria-live="polite"><div><span>Rendering locally</span><strong>{progress}%</strong></div><div className="generation-progress-track" role="progressbar" aria-label="Local render progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div><button type="button" className="quiet-button" onClick={() => abortRef.current?.abort()}>Cancel render</button></div> : <button type="button" className="primary-button" disabled={!renderable} onClick={() => void renderLocally()}>Render MP4 locally<span aria-hidden="true">→</span></button>}
    {videoUrl && <div className="local-render-result"><video src={videoUrl} controls playsInline preload="metadata" aria-label="Local storyboard video preview" /><a className="primary-button" href={videoUrl} download={fileName}>Download MP4<span aria-hidden="true">↓</span></a></div>}
  </section>;
}
