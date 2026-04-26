import { handleAnalyzeRoute } from "./src/routes/analyze.ts";
import { handleHealthRoute } from "./src/routes/health.ts";
import { getMetricsSnapshot } from "./src/observability/metrics.ts";
import { logger } from "./src/observability/logger.ts";

const port = Number(Bun.env.PORT ?? 3001);

const server = Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return handleHealthRoute();
    }

    if (request.method === "GET" && url.pathname === "/metrics") {
      return Response.json({ ok: true, metrics: getMetricsSnapshot() });
    }

    if (request.method === "POST" && url.pathname === "/analyze") {
      return handleAnalyzeRoute(request);
    }

    return Response.json(
      {
        ok: false,
        error: "Not found",
      },
      { status: 404 },
    );
  },
});

logger.info("server.started", {
  port: server.port,
  pipelineVersion: "v1.0.0",
});
