"use client";

import { useState } from "react";
import type { FormEvent } from "react";

export default function HomePage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackType, setFeedbackType] = useState<"error" | "info" | "">("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");

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

    setFeedbackType("info");
    setFeedback("This sign-in mock is ready for the authentication integration step.");
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
            <div className="form-heading">
              <p className="eyebrow">YOUR CREATIVE STUDIO</p>
              <h1 id="sign-in-title">Welcome back</h1>
              <p className="form-subtitle">Sign in to continue building your next story.</p>
            </div>

            <form className="sign-in-form" onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label htmlFor="email">Email address</label>
                <input
                  autoComplete="email"
                  id="email"
                  name="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  value={email}
                />
              </div>

              <div className="field">
                <div className="field-label-row">
                  <label htmlFor="password">Password</label>
                  <a href="#forgot-password" className="text-link">Forgot password?</a>
                </div>
                <div className="password-field">
                  <input
                    autoComplete="current-password"
                    id="password"
                    name="password"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                  />
                  <button
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="visibility-button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    type="button"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {feedback && (
                <p className={`form-feedback ${feedbackType}`} role="status">
                  {feedback}
                </p>
              )}

              <button className="primary-button" type="submit">
                Sign in <span aria-hidden="true">→</span>
              </button>
            </form>

            <p className="signup-prompt">
              New to VideoGen? <a href="#create-account" className="text-link">Create an account</a>
            </p>
            <p className="mock-note">Design mock · Authentication is not connected yet</p>
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
