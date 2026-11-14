import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VideoGen Studio",
  description: "Shape your idea, review each scene, and build your video in VideoGen Studio.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
