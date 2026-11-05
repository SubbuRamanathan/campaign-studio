"use client";

import { useEffect } from "react";

// Where the sign-in window lands. It closes itself; the panel keeps working.
export default function SignedIn() {
  useEffect(() => window.close(), []);
  return <p className="p-4 text-sm">Signed in. You can close this window and run Campaign Studio again.</p>;
}
