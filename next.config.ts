import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {};

// Mounts the agent in agent/ at /eve/v1/* so app/api/campaign can call it.
export default withEve(nextConfig);
