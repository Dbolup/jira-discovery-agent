import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jira Migration Discovery Assistant",
  description:
    "RAG assistant for Jira Cloud-to-Cloud migration discovery, powered by Claude.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
