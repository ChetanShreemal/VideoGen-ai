"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

interface ResetPasswordFormProps {
  token?: string;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [feedback, setFeedback] = useState("");
  const [success, setSuccess] = useState(false);
  const [invalidLink, setInvalidLink] = useState(!token);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");

    if (!token) {
      setInvalidLink(true);
      return;
    }
    if (password.length < 8 || password.length > 128) {
      setFeedback("Use a password between 8 and 128 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setFeedback("The passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        setInvalidLink(true);
        return;
      }
      setSuccess(true);
    } catch {
      setFeedback("We couldn't reset your password. Try again shortly.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="reset-card" aria-labelledby="reset-title">
      <p className="eyebrow">ACCOUNT SECURITY</p>
      <h1 id="reset-title">
        {success ? "Password updated" : invalidLink ? "Reset link unavailable" : "Choose a new password"}
      </h1>
      <p className="form-subtitle">
        {success
          ? "Your password has been changed and other sessions have been signed out. You can return to sign in."
          : invalidLink
            ? "This reset link is invalid or has expired. Request a new one."
            : "Create a new password for your VideoGen account."}
      </p>

      {success ? (
        <a className="primary-button reset-submit" href="/">Return to sign in</a>
      ) : invalidLink ? (
        <div className="reset-invalid">
          <a className="primary-button reset-submit" href="/">Back to sign in</a>
        </div>
      ) : (
        <form className="sign-in-form reset-form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <input autoComplete="new-password" id="new-password" maxLength={128} minLength={8} onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirm new password</label>
            <input autoComplete="new-password" id="confirm-password" maxLength={128} minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} type="password" value={confirmPassword} />
          </div>
          {feedback && <p className="form-feedback error" role="status">{feedback}</p>}
          <button className="primary-button reset-submit" disabled={submitting} type="submit">
            {submitting ? "Updating password…" : "Update password"}
          </button>
        </form>
      )}
    </section>
  );
}
