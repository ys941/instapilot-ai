﻿import type { NextConfig } from 'next'
import path from 'node:path'

const nextConfig: NextConfig = {
  // Next.js infers the workspace root from the nearest lockfile, and can pick
  // C:\Users\ys941\package-lock.json (an unrelated project in the home
  // directory) instead of this one when running `next dev --turbo`. Pin the
  // root so module resolution and file watching stay scoped to this project.
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'graph.facebook.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'cdninstagram.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.cdninstagram.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'scontent.cdninstagram.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lookaside.fbsbx.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'files.catbox.moe',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        pathname: '/**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 3600,
  },
  experimental: {
    // Turbopack's persistent filesystem cache is ON by default from Next 16.1.
    // On this machine it stalls hard - measured "writing to filesystem cache
    // in 39.1s" and "filesystem cache database compaction in 49s" on a dev
    // start, which pushed first paint past 3 minutes. Its many small
    // read/write ops don't pay off on a 2-core CPU-only laptop. Turning it off
    // trades a slower warm restart for a dev server that actually comes up.
    turbopackFileSystemCacheForDev: false,
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      'framer-motion',
      'date-fns',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-avatar',
      '@radix-ui/react-switch',
      '@radix-ui/react-progress',
      '@tanstack/react-query',
    ],
  },
  // Standalone build for Docker (the Dockerfile copies .next/standalone).
  output: 'standalone',
  env: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    // White-label: app name comes from env (Settings → Brand can override per account at runtime).
    NEXT_PUBLIC_APP_NAME:
      process.env.NEXT_PUBLIC_APP_NAME || process.env.BRAND_NAME || 'InstaPilot AI',
  },
  poweredByHeader: false,
  compress: true,
  reactStrictMode: false, // disabled  -  was causing every component to render twice in dev
}

export default nextConfig

