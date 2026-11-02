import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sign in | VideoGen",
  description: "A design mock for the VideoGen sign-in experience.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
