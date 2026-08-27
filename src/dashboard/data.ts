import "server-only";

import { dashboardDemoData, isDashboardDemoMode } from "./demo-data";
import { loadScopedDashboardData } from "./dashboard-query";
import type { DashboardScope } from "./scope";
import type { DashboardLoadResult } from "./types";

export { isDashboardDemoMode } from "./demo-data";

export async function loadDashboardData(
  scope: DashboardScope | null,
): Promise<DashboardLoadResult> {
  if (isDashboardDemoMode()) {
    return { data: dashboardDemoData, status: "demo" };
  }

  if (scope === null) {
    return { status: "unauthenticated" };
  }

  if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL.trim().length === 0) {
    return { status: "unconfigured" };
  }

  try {
    const { prisma } = await import("../lib/prisma");
    return { data: await loadScopedDashboardData(prisma, scope), status: "ready" };
  } catch (error) {
    console.error("Dashboard data loading failed.", error);
    return {
      message:
        "The dashboard could not reach PostgreSQL. Check DATABASE_URL, Prisma migrations, and the database service before retrying.",
      status: "unavailable",
    };
  }
}
