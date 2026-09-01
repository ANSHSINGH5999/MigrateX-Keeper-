import type { Metadata } from "next";
import { Instrument_Serif, Great_Vibes, Space_Mono, DM_Sans } from "next/font/google";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--f-serif",
});

const greatVibes = Great_Vibes({
  subsets: ["latin"],
  weight: "400",
  variable: "--f-cursive",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--f-mono",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--f-body",
});

export const metadata: Metadata = {
  title: "MigrateX",
  description: "Deterministic token migration orchestrator, executed through KeeperHub.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${greatVibes.variable} ${spaceMono.variable} ${dmSans.variable} h-full`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
