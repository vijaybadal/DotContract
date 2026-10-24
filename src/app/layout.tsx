import type { Metadata } from "next";
import "@fontsource-variable/public-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "DOTComm Contracts", template: "%s · DOTComm Contracts" },
  description: "IT contract lifecycle management for DOTComm, the City of Omaha and Douglas County.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
