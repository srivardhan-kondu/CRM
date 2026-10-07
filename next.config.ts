import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: false,
  // Notices upload up to 4 MB of attachments per save; serverless hosts cap requests at ~4.5 MB.
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
