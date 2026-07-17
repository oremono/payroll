import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pin the workspace root to this project so Turbopack's file tracing doesn't latch onto an
  // unrelated lockfile higher up the filesystem (e.g. ~/package-lock.json).
  turbopack: {
    root: fileURLToPath(new URL('.', import.meta.url)),
  },
};

export default nextConfig;
