import { createServer, type Server, type ServerResponse } from "node:http";

import {
  createStructuredLogger,
  errorLogFields,
  type StructuredLogger,
} from "../observability/structured-logger.js";

export interface WorkerHealthSnapshot {
  lastErrorAt: string | null;
  lastIterationAt: string | null;
  startedAt: string;
}

export interface WorkerHealthOptions {
  probe: () => Promise<void>;
}

export class WorkerHealth {
  private lastErrorAt: Date | null = null;
  private lastIterationAt: Date | null = null;
  private readonly startedAt = new Date();

  constructor(private readonly options: WorkerHealthOptions) {}

  recordIteration(): void {
    this.lastIterationAt = new Date();
  }

  recordError(): void {
    this.lastErrorAt = new Date();
  }

  snapshot(): WorkerHealthSnapshot {
    return {
      lastErrorAt: this.lastErrorAt?.toISOString() ?? null,
      lastIterationAt: this.lastIterationAt?.toISOString() ?? null,
      startedAt: this.startedAt.toISOString(),
    };
  }

  async readiness(): Promise<{ ready: boolean; snapshot: WorkerHealthSnapshot }> {
    try {
      await this.options.probe();
      return { ready: true, snapshot: this.snapshot() };
    } catch {
      this.recordError();
      return { ready: false, snapshot: this.snapshot() };
    }
  }
}

export interface WorkerHealthServerOptions {
  host?: string;
  logger?: StructuredLogger;
  port: number;
}

export interface WorkerHealthServer {
  close(): Promise<void>;
}

export async function startWorkerHealthServer(
  health: WorkerHealth,
  options: WorkerHealthServerOptions,
): Promise<WorkerHealthServer> {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new RangeError("Worker health port must be between 1 and 65535.");
  }
  const logger =
    options.logger ??
    createStructuredLogger({ baseFields: { component: "worker-health-server" } });
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" });
        response.end();
        return;
      }
      if (request.url === "/healthz") {
        writeJson(response, 200, { status: "ok", ...health.snapshot() });
        return;
      }
      if (request.url === "/readyz") {
        const readiness = await health.readiness();
        writeJson(response, readiness.ready ? 200 : 503, {
          status: readiness.ready ? "ready" : "not_ready",
          ...readiness.snapshot,
        });
        return;
      }
      response.writeHead(404);
      response.end();
    } catch (error) {
      health.recordError();
      logger.error("worker_health_request_failed", errorLogFields(error));
      writeJson(response, 503, { status: "not_ready" });
    }
  });

  await listen(server, options.port, options.host ?? "0.0.0.0");
  logger.info("worker_health_server_started", {
    host: options.host ?? "0.0.0.0",
    port: options.port,
  });
  return {
    close: () => close(server),
  };
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      server.off("listening", succeed);
      reject(error);
    };
    const succeed = () => {
      server.off("error", fail);
      resolve();
    };
    server.once("error", fail);
    server.once("listening", succeed);
    server.listen(port, host);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
