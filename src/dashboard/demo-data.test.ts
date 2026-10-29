import assert from "node:assert/strict";
import test from "node:test";

import {
  dashboardDemoData,
  isDashboardDemoMode,
  isPublicDemoDeployment,
} from "./demo-data.js";

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

test("serves demo data in production only for an explicit public demo deployment", () => {
  assert.equal(
    isDashboardDemoMode({ NODE_ENV: "production", PUBLIC_DEMO_DEPLOYMENT: "true" }),
    true,
  );
  assert.equal(isPublicDemoDeployment({ PUBLIC_DEMO_DEPLOYMENT: "true" }), true);
  for (const value of [undefined, "", "false", "1", "TRUE", "yes"]) {
    assert.equal(isPublicDemoDeployment({ PUBLIC_DEMO_DEPLOYMENT: value }), false);
    assert.equal(
      isDashboardDemoMode({
        DASHBOARD_DEMO_MODE: "true",
        NODE_ENV: "production",
        PUBLIC_DEMO_DEPLOYMENT: value,
      }),
      false,
    );
  }
});

test("provides a complete typed dashboard view model for local screenshots", () => {
  assert.equal(dashboardDemoData.metrics.totalRepositories, 4);
  assert.equal(dashboardDemoData.history.length > 0, true);
  assert.equal(dashboardDemoData.categories.length > 0, true);
  assert.equal(dashboardDemoData.history.every((review) => review.riskScore !== null), true);
});
