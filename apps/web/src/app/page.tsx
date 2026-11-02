"use client";

import { useState } from "react";
import { useEffect } from "react";
import type { FormEvent } from "react";
import { currentUserResponseSchema } from "@videogen/contracts";
import { apiBaseURL, authClient } from "@/lib/auth-client";

export default function HomePage() {
  const { data: session, isPending: sessionPending, refetch } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackType, setFeedbackType] = useState<"error" | "info" | "">("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [submitting, setSubmitting] = useState(false);
  const [protectedUser, setProtectedUser] = useState<string | null>(null);
  const [checkingApiSession, setCheckingApiSession] = useState(false);

  useEffect(() => {
    if (!session) {
      setProtectedUser(null);
      setCheckingApiSession(false);
      return;
    }

    let active = true;
    setCheckingApiSession(true);
    void fetch(`${apiBaseURL}/me`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("API session check failed");
        const payload = currentUserResponseSchema.parse(await response.json());
        if (active) setProtectedUser(payload.data.user.email);
      })
      .catch(() => {
        if (active) setProtectedUser(null);
      })
      .finally(() => {
        if (active) setCheckingApiSession(false);
      });

    return () => {
      active = false;
    };
  }, [session?.user.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    setFeedbackType("");

    if (!email.trim() || !password) {
      setFeedbackType("error");
      setFeedback("Enter your email and password to continue.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFeedbackType("error");
      setFeedback("Enter a valid email address.");
      return;
    }

    if (mode === "sign-up" && !name.trim()) {
      setFeedbackType("error");
      setFeedback("Enter your name to create an account.");
      return;
    }

    if (mode === "sign-up" && (password.length < 8 || password.length > 128)) {
      setFeedbackType("error");
      setFeedback("Use a password between 8 and 128 characters.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "sign-up") {
        const result = await authClient.signUp.email({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
        });

        if (result.error) {
          setFeedbackType("error");
          setFeedback("We couldn't create your account. Check your details and try again.");
          return;
        }

        setMode("sign-in");
        setPassword("");
        setFeedbackType("info");
        setFeedback("If this email is available, your account is ready. Sign in to continue.");
        return;
      }

      const result = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
      });

      if (result.error) {
        setFeedbackType("error");
        setFeedback("The email or password is incorrect.");
        return;
      }

      await refetch();
      setPassword("");
    } catch {
      setFeedbackType("error");
      setFeedback("Authentication is temporarily unavailable. Try again shortly.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    setSubmitting(true);
    setFeedback("");
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setFeedbackType("error");
        setFeedback("We couldn't sign you out. Try again.");
        return;
      }
      await refetch();
      setFeedbackType("info");
      setFeedback("You have been signed out.");
    } catch {
      setFeedbackType("error");
      setFeedback("We couldn't reach the sign-out service. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-shell">
        <header className="auth-header">
          <a className="brand" href="#" aria-label="VideoGen home">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 4.8h5.2l8.9 14.4h-5.2L5 4.8Z" fill="currentColor" />
                <path d="M14.8 4.8H20l-8.9 14.4H5.9l8.9-14.4Z" fill="currentColor" opacity=".58" />
              </svg>
            </span>
            <span>VideoGen</span>
          </a>
          <a className="help-link" href="mailto:support@videogen.example">Need help?</a>
        </header>

        <section className="auth-content" aria-labelledby="sign-in-title">
          <div className="auth-form-panel">
            {sessionPending ? (
              <p className="form-feedback info" role="status">Checking your session…</p>
            ) : session ? (
              <div className="authenticated-panel">
                <div className="form-heading">
                  <p className="eyebrow">YOUR CREATIVE STUDIO</p>
                  <h1 id="sign-in-title">You’re signed in</h1>
                  <p className="form-subtitle">Your account session is active.</p>
                </div>
                <div className="session-card" aria-live="polite">
                  <span className="session-indicator" aria-hidden="true" />
                  <div>
                    <strong>{session.user.name || session.user.email}</strong>
                    <small>{checkingApiSession ? "Checking protected API…" : protectedUser ?? "API session could not be verified"}</small>
                  </div>
                </div>
                {feedback && <p className={`form-feedback ${feedbackType}`} role="status">{feedback}</p>}
                <button className="primary-button" disabled={submitting} onClick={handleSignOut} type="button">
                  {submitting ? "Signing out…" : "Sign out"}
                </button>
                <p className="mock-note">Authentication connected · Project workspace is the next slice</p>
              </div>
            ) : (
              <>
                <div className="form-heading">
                  <p className="eyebrow">YOUR CREATIVE STUDIO</p>
                  <h1 id="sign-in-title">{mode === "sign-in" ? "Welcome back" : "Create your account"}</h1>
                  <p className="form-subtitle">
                    {mode === "sign-in" ? "Sign in to continue building your next story." : "Start building your next story with VideoGen."}
                  </p>
                </div>

                <form className="sign-in-form" onSubmit={handleSubmit} noValidate>
                  {mode === "sign-up" && (
                    <div className="field">
                      <label htmlFor="name">Your name</label>
                      <input autoComplete="name" id="name" name="name" onChange={(event) => setName(event.target.value)} placeholder="Your name" value={name} />
                    </div>
                  )}
                  <div className="field">
                    <label htmlFor="email">Email address</label>
                    <input autoComplete="email" id="email" name="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" type="email" value={email} />
                  </div>

                  <div className="field">
                    <div className="field-label-row">
                      <label htmlFor="password">Password</label>
                      {mode === "sign-in" && (
                        <button className="text-link text-button" onClick={() => {
                          setFeedbackType("info");
                          setFeedback("Password recovery will be available after email delivery is configured.");
                        }} type="button">Forgot password?</button>
                      )}
                    </div>
                    <div className="password-field">
                      <input autoComplete={mode === "sign-in" ? "current-password" : "new-password"} id="password" name="password" onChange={(event) => setPassword(event.target.value)} placeholder={mode === "sign-in" ? "Enter your password" : "Create a password"} type={showPassword ? "text" : "password"} value={password} />
                      <button aria-label={showPassword ? "Hide password" : "Show password"} className="visibility-button" onClick={() => setShowPassword((visible) => !visible)} type="button">
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>

                  {feedback && <p className={`form-feedback ${feedbackType}`} role="status">{feedback}</p>}

                  <button className="primary-button" disabled={submitting} type="submit">
                    {submitting ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"} <span aria-hidden="true">→</span>
                  </button>
                </form>

                <p className="signup-prompt">
                  {mode === "sign-in" ? "New to VideoGen?" : "Already have an account?"}{" "}
                  <button className="text-link text-button" disabled={submitting} onClick={() => {
                    setMode(mode === "sign-in" ? "sign-up" : "sign-in");
                    setFeedback("");
                    setFeedbackType("");
                  }} type="button">{mode === "sign-in" ? "Create an account" : "Sign in"}</button>
                </p>
                <p className="mock-note">Sign-in is ready for development. Email verification is not configured.</p>
              </>
            )}
          </div>

          <aside className="story-panel" aria-label="VideoGen product preview">
            <div className="story-grid" aria-hidden="true" />
            <div className="story-copy">
              <p className="story-kicker"><span /> MADE FOR YOUR NEXT IDEA</p>
              <h2>From a spark<br />to a story worth sharing.</h2>
              <p className="story-description">Shape your idea, review every scene, and bring your video to life.</p>
              <div className="story-preview" aria-label="Sample video project preview">
                <div className="preview-scene">
                  <span className="sun" />
                  <span className="hill hill-back" />
                  <span className="hill hill-front" />
                  <span className="scene-caption">A little curiosity<br />can change everything.</span>
                  <span className="play-button" aria-hidden="true">▶</span>
                </div>
                <div className="preview-meta">
                  <span><strong>The curious seed</strong><small>EDUCATIONAL · 00:32</small></span>
                  <span className="preview-status"><i /> STORYBOARD READY</span>
                </div>
              </div>
              <p className="story-footnote">A calmer way to make videos, one thoughtful step at a time.</p>
            </div>
          </aside>
        </section>

        <footer className="auth-footer">
          <span>© 2026 VideoGen</span>
          <span className="footer-links"><a href="#privacy">Privacy</a><a href="#terms">Terms</a></span>
        </footer>
      </div>
    </main>
  );
}
