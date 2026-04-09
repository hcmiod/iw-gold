import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "IW-Gold — Bulk Email Platform", description: "Professional bulk email sending with Gmail pool rotation" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
