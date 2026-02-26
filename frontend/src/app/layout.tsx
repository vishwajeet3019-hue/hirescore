import type { Metadata } from "next";
import AppChrome from "./components/app-chrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "HireScore AI",
  description: "AI-powered resume analysis and optimization platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased overflow-x-hidden">
        <div className="pointer-events-none fixed inset-0 -z-20 overflow-hidden">
          <div className="futuristic-grid animate-grid-drift" />
          <div className="animate-orbital absolute -left-28 top-10 h-80 w-80 rounded-full bg-cyan-400/20 blur-[110px]" />
          <div className="animate-orbital absolute -right-20 top-56 h-96 w-96 rounded-full bg-sky-400/20 blur-[140px]" />
          <div className="animate-drift absolute bottom-[-180px] left-1/3 h-[360px] w-[360px] rounded-full bg-amber-200/16 blur-[130px]" />
        </div>
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
