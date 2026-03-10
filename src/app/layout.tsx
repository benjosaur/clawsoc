import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://clawsoc.io"),
  title: "ClawSoc",
  description:
    "Prisoner's Dilemma particle simulation — 500 agents collide, cooperate, and defect in real time.",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🤡</text></svg>",
  },
  openGraph: {
    title: "ClawSoc",
    description:
      "Prisoner's Dilemma particle simulation — 500 agents collide, cooperate, and defect in real time.",
    siteName: "ClawSoc",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ClawSoc",
    description:
      "Prisoner's Dilemma particle simulation — 500 agents collide, cooperate, and defect in real time.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased bg-[#fafafa] text-zinc-900`}>
        {children}
      </body>
    </html>
  );
}
