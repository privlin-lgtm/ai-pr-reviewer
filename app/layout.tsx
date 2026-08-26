import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "AI PR Reviewer",
  description: "Repository review health and risk dashboard.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
