import assert from "node:assert/strict";
import test from "node:test";

import { dashboardDemoData, isDashboardDemoMode } from "./demo-data.js";

test("enables dashboard demo data only with the explicit development flag", () => {
  assert.equal(
    isDashboardDemoMode({ DASHBOARD_DEMO_MODE: "true", NODE_ENV: "development" }),
    true,
  );
  assert.equal(isDashboardDemoMode({ NODE_ENV: "development" }), false);
  assert.equal(
    isDashboardDemoMode({ DASHBOARD_DEMO_MODE: "true", NODE_ENV: "production" }),
    false,
  );
});

test("provides a complete typed dashboard view model for local screenshots", () => {
  assert.equal(dashboardDemoData.metrics.totalRepositories, 4);
  assert.equal(dashboardDemoData.history.length > 0, true);
  assert.equal(dashboardDemoData.categories.length > 0, true);
  assert.equal(dashboardDemoData.history.every((review) => review.riskScore !== null), true);
});
