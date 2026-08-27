import type { Metadata } from "next";
// self-hosted Geist via the official npm package (same --font-geist-* variables) — a build-time fetch
// from Google Fonts is a network dependency that intermittently breaks CI release builds
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { LocaleInitializer } from "@/components/locale-initializer";
import { AppShell } from "@/components/app-shell";

const geistSans = GeistSans;
const geistMono = GeistMono;

export const metadata: Metadata = {
  // Title/description are bilingual (Chinese first): prioritize domestic traffic while covering overseas search indexing
  title: "Mora — 面向零售自动化的多模态编排平台",
  description:
    "Mora 是面向商户的本地视频创作平台，用于组织商品资料、脚本、画面、配音、字幕与视频合成流程。",
  keywords: [
    "AI 短视频",
    "带货短视频",
    "AI 视频生成",
    "抖音",
    "快手",
    "小红书",
    "TikTok",
    "text to video",
    "faceless video",
    "AI video generator",
  ],
};

const themeScript = `(() => {
  try {
    const saved = localStorage.getItem("mora_theme");
    const dark = saved === "dark" || (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch {}
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <LocaleInitializer />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
