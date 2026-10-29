import { NextResponse } from "next/server";

import { isPublicDemoDeployment } from "./src/dashboard/demo-data";

export function proxy() {
  return isPublicDemoDeployment()
    ? NextResponse.json(
        { error: "This is a public demo. Its API routes are switched off." },
        { headers: { "cache-control": "no-store" }, status: 404 },
      )
    : NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
