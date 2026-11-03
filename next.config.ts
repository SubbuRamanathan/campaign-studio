import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  // Only SitecoreAI may embed the panel in an iframe.
  async headers() {
    return [
      {
        source: "/campaign-studio",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self' https://*.sitecorecloud.io" }],
      },
    ];
  },
};

// Mounts the agent in agent/ at /eve/v1/* so app/api/campaign can call it.
export default withEve(nextConfig);
