import { Resend } from "resend";
import { config } from "./config.js";

const resend = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;

function escapeHtml(value: string): string {
  const escapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => escapes[character] ?? character);
}

export async function sendPasswordResetEmail(to: string, url: string): Promise<void> {
  if (!resend) {
    throw new Error("Resend is not configured.");
  }

  const safeUrl = escapeHtml(url);
  const { error } = await resend.emails.send({
    from: config.AUTH_EMAIL_FROM,
    to,
    subject: "Reset your VideoGen password",
    text: `Use this link to reset your VideoGen password. This link expires in one hour.\n\n${url}\n\nIf you didn't request this, you can ignore this email.`,
    html: `<p>We received a request to reset your VideoGen password.</p><p><a href="${safeUrl}">Reset your password</a></p><p>This link expires in one hour. If you didn't request this, you can ignore this email.</p>`,
  });

  if (error) {
    throw new Error("Resend could not deliver the password reset email.");
  }
}
