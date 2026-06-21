import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

function smoothcompRefreshPlugin() {
  let refreshJob = {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    snapshot: null,
    error: "",
    stdout: "",
    stderr: ""
  };

  function publicJob() {
    return {
      status: refreshJob.status,
      startedAt: refreshJob.startedAt,
      finishedAt: refreshJob.finishedAt,
      snapshot: refreshJob.snapshot,
      error: refreshJob.error,
      stdout: refreshJob.stdout.slice(-4000),
      stderr: refreshJob.stderr.slice(-4000)
    };
  }

  async function startRefresh(root) {
    const previousSnapshotText = await readFile("src/generated/smoothcomp-live-snapshot.json", "utf8");
    const previousSnapshot = JSON.parse(previousSnapshotText);
    const eventUrls = Array.isArray(previousSnapshot.events)
      ? previousSnapshot.events.map((event) => event?.sourceUrl).filter(Boolean)
      : [];

    if (eventUrls.length === 0) {
      throw new Error("No Smoothcomp events are available to refresh.");
    }

    refreshJob = {
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      snapshot: null,
      error: "",
      stdout: "",
      stderr: ""
    };

    const child = spawn(
      "node",
      [
        "scripts/smoothcomp-sync.mjs",
        "--event-limit=all",
        "--bracket-limit=all",
        "--match-limit=all",
        "--live-score-limit=500",
        ...eventUrls.flatMap((url) => ["--event", url])
      ],
      { cwd: root }
    );

    child.stdout.on("data", (chunk) => {
      refreshJob.stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      refreshJob.stderr += chunk.toString();
    });

    child.on("error", (error) => {
      refreshJob = {
        ...refreshJob,
        status: "error",
        finishedAt: new Date().toISOString(),
        error: error.message
      };
    });

    child.on("close", async (code) => {
      if (code !== 0) {
        refreshJob = {
          ...refreshJob,
          status: "error",
          finishedAt: new Date().toISOString(),
          error: refreshJob.stderr || refreshJob.stdout || `Smoothcomp sync exited with code ${code}.`
        };
        return;
      }

      try {
        const snapshotText = await readFile("src/generated/smoothcomp-live-snapshot.json", "utf8");
        refreshJob = {
          ...refreshJob,
          status: "complete",
          finishedAt: new Date().toISOString(),
          snapshot: JSON.parse(snapshotText)
        };
      } catch (error) {
        refreshJob = {
          ...refreshJob,
          status: "error",
          finishedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });
  }

  return {
    name: "smoothcomp-refresh-api",
    configureServer(server) {
      server.middlewares.use("/api/smoothcomp/refresh", async (req, res) => {
        if (req.method === "GET") {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(publicJob()));
          return;
        }

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        try {
          if (refreshJob.status !== "running") {
            await startRefresh(server.config.root);
          }

          res.statusCode = 202;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(publicJob()));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error)
            })
          );
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), smoothcompRefreshPlugin()],
  server: {
    port: 5173,
    strictPort: false
  }
});
