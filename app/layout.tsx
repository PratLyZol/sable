import type { Metadata } from "next";
import { Fraunces, Spline_Sans, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
});

const ui = Spline_Sans({
  variable: "--font-ui",
  subsets: ["latin"],
});

const data = Spline_Sans_Mono({
  variable: "--font-data",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sable — the private spending layer",
  description:
    "Walletless payroll, confidential vendor payments, and AI agent fleets that pay their own way over x402 — private by default, disclosable on demand, budgeted so nothing runs away.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${data.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
