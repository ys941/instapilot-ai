import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const BRAND_NAME = process.env.BRAND_NAME ?? "InstaPilot AI";
const BRAND_TAGLINE = process.env.BRAND_TAGLINE ?? "AI-powered Instagram content automation";
const BRAND_DESCRIPTION =
  process.env.BRAND_TAGLINE ??
  "AI-powered content automation platform for Instagram. Generate, schedule, and analyze content with Gemini or Grok AI.";

export const metadata: Metadata = {
  title: {
    default: `${BRAND_NAME} — ${BRAND_TAGLINE}`,
    template: `%s | ${BRAND_NAME}`,
  },
  description: BRAND_DESCRIPTION,
  keywords: [
    "AI content",
    "Instagram automation",
    "content creation",
    "social media",
    "content scheduling",
  ],
  authors: [{ name: BRAND_NAME }],
  creator: BRAND_NAME,
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  ),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    title: `${BRAND_NAME} — ${BRAND_TAGLINE}`,
    description: BRAND_DESCRIPTION,
    siteName: BRAND_NAME,
  },
  twitter: {
    card: "summary_large_image",
    title: BRAND_NAME,
    description: BRAND_TAGLINE,
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon-16x16.png",
    apple: "/apple-touch-icon.png",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0F",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${sora.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased bg-[#0A0A0F] text-white min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
