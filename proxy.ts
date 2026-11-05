import type { NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0";

// Mounts the sign-in routes (/auth/login, /auth/callback, /auth/logout).
export const proxy = (req: NextRequest) => auth0.middleware(req);

export const config = { matcher: ["/auth/:path*"] };
