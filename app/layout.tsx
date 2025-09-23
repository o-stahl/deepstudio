import type { Metadata, Viewport } from "next";
import { Inter, PT_Sans } from "next/font/google";

import TanstackProvider from "@/components/providers/tanstack-query-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import "@/assets/globals.css";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  variable: "--font-inter-sans",
  subsets: ["latin"],
});

const ptSans = PT_Sans({
  variable: "--font-ptSans-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "DeepStudio | Agentic AI Development 🎨",
  description:
    "DeepStudio is an AI-powered development environment that enables autonomous multi-file development through intelligent tool usage. Build complete applications with natural language.",
  openGraph: {
    title: "DeepStudio | Agentic AI Development 🎨",
    description:
      "DeepStudio is an AI-powered development environment that enables autonomous multi-file development through intelligent tool usage. Build complete applications with natural language.",
    url: "https://huggingface.co/spaces/otst/deepstudio",
    siteName: "DeepStudio",
    images: [
      {
        url: "https://huggingface.co/spaces/otst/deepstudio/resolve/main/banner.png",
        width: 1200,
        height: 630,
        alt: "DeepStudio Open Graph Image",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "DeepStudio | Agentic AI Development 🎨",
    description:
      "DeepStudio is an AI-powered development environment that enables autonomous multi-file development through intelligent tool usage. Build complete applications with natural language.",
    images: ["https://huggingface.co/spaces/otst/deepstudio/resolve/main/banner.png"],
  },
  appleWebApp: {
    capable: true,
    title: "DeepStudio",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/deepstudio-logo-dark.svg",
    shortcut: "/deepstudio-logo-dark.svg",
    apple: "/deepstudio-logo-dark.svg",
  },
};

export const viewport: Viewport = {
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${ptSans.variable} antialiased bg-background h-[100dvh] overflow-hidden`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <Toaster richColors position="bottom-center" />
          <TanstackProvider>
            {children}
          </TanstackProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
