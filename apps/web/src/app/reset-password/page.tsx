import { ResetPasswordForm } from "./reset-password-form";

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : undefined;

  return (
    <main className="reset-page">
      <a className="brand reset-brand" href="/" aria-label="VideoGen home">
        <span className="brand-mark material-symbols-outlined" aria-hidden="true">play_arrow</span>
        <span>VideoGen</span>
      </a>
      <ResetPasswordForm token={token} />
    </main>
  );
}
