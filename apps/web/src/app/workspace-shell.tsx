"use client";

import Link from "next/link";

type WorkspaceArea = "projects" | "storyboard" | "audio";

const futureNavigation = [
  ["hourglass_top", "Generation Progress"],
  ["rate_review", "Video Preview & Review"],
  ["perm_media", "Media Library"],
  ["history", "Generation History"],
  ["face", "Characters"],
  ["settings", "Settings"],
] as const;

export function WorkspaceShell({
  children,
  name,
  email,
  active,
  projectId,
  onSignOut,
  onCreateVideo,
  signingOut = false,
}: {
  children: React.ReactNode;
  name: string;
  email: string;
  active: WorkspaceArea;
  projectId?: string;
  onSignOut?: () => void;
  onCreateVideo?: () => void;
  signingOut?: boolean;
}) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "VG";
  const projectHref = projectId ? `/projects/${projectId}` : null;

  return (
    <div className="studio-shell">
      <aside className="studio-sidebar" aria-label="VideoGen workspace navigation">
        <Link className="studio-brand" href="/" aria-label="VideoGen Projects">
          <span className="studio-brand-mark" aria-hidden="true"><span className="material-symbols-outlined">play_arrow</span></span>
          <span>VideoGen</span>
        </Link>

        <div className="studio-workspace-card">
          <span className="studio-lock material-symbols-outlined" aria-hidden="true">lock</span>
          <span className="studio-workspace-copy"><strong>{name || "Your Studio"}</strong><small>Private Workspace</small></span>
          <span className="material-symbols-outlined studio-chevron" aria-hidden="true">expand_more</span>
        </div>

        <nav className="studio-nav" aria-label="Workspace">
          <Link className={active === "projects" ? "studio-nav-link active" : "studio-nav-link"} href="/" aria-label="Projects" title="Projects" aria-current={active === "projects" ? "page" : undefined}>
            <span className="material-symbols-outlined" aria-hidden="true">folder</span><span>Projects</span>
          </Link>
          {onCreateVideo ? <button className="studio-nav-link studio-nav-button" type="button" aria-label="Create Video" title="Create Video" onClick={onCreateVideo}><span className="material-symbols-outlined" aria-hidden="true">add_circle</span><span>Create Video</span><span className="studio-create-tag">+ CREATE</span></button> : <Link className="studio-nav-link" href="/#new-project" aria-label="Create Video" title="Create Video"><span className="material-symbols-outlined" aria-hidden="true">add_circle</span><span>Create Video</span><span className="studio-create-tag">+ CREATE</span></Link>}
          <Link className={active === "storyboard" ? "studio-nav-link active" : "studio-nav-link"} href={projectHref ? `${projectHref}#storyboard` : "/"} aria-label="Storyboard" title="Storyboard" aria-current={active === "storyboard" ? "page" : undefined}>
            <span className="material-symbols-outlined" aria-hidden="true">auto_stories</span><span>Storyboard</span>
          </Link>
          <Link className={active === "audio" ? "studio-nav-link active" : "studio-nav-link"} href={projectHref ? `${projectHref}#audio-settings-title` : "/"} aria-label="Voice & Audio Studio" title="Voice & Audio Studio" aria-current={active === "audio" ? "page" : undefined}>
            <span className="material-symbols-outlined" aria-hidden="true">mic</span><span>Voice &amp; Audio Studio</span>
          </Link>
          <div className="studio-nav-divider" />
          {futureNavigation.map(([icon, label]) => (
            <span className="studio-nav-link unavailable" key={label} aria-disabled="true" title={`${label} screen is planned, but not implemented yet`}>
              <span className="material-symbols-outlined" aria-hidden="true">{icon}</span><span>{label}</span>
            </span>
          ))}
        </nav>

        <div className="studio-sidebar-spacer" />
        <section className="studio-tip" aria-label="Creator tip">
          <p><span className="material-symbols-outlined" aria-hidden="true">tips_and_updates</span> CREATOR TIP</p>
          <span>Keep your story focused. A clear idea makes every scene easier to shape.</span>
        </section>
        <div className="studio-profile">
          <span className="studio-avatar" aria-hidden="true">{initials}</span>
          <span className="studio-profile-copy"><strong>{name || "Creator"}</strong><small>{email}</small></span>
          {onSignOut && <button className="studio-signout" type="button" onClick={onSignOut} disabled={signingOut} aria-label={signingOut ? "Signing out" : "Sign out"} title={signingOut ? "Signing out…" : "Sign out"}><span className="material-symbols-outlined" aria-hidden="true">logout</span></button>}
        </div>
      </aside>
      <div className="studio-main">
        <header className="studio-topbar">
          <span className="studio-current-area">{active === "projects" ? "Individual Creator Workspace" : active === "audio" ? "Voice & Audio Studio" : "Project Workspace"}</span>
          <span className="studio-topbar-user"><span className="studio-avatar" aria-hidden="true">{initials}</span><span>{name || email}</span></span>
        </header>
        <div className="studio-main-content">{children}</div>
      </div>
    </div>
  );
}
