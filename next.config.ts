import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf2json'],
  outputFileTracingIncludes: { '/*': ['./lib/pdf/pdf-worker.mjs'] },
};

export default nextConfig;
