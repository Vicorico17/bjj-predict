import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function smoothcompRefreshPlugin() {
  return {
    name: "smoothcomp-refresh-api",
    configureServer(server) {
      server.middlewares.use("/api/smoothcomp/refresh", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        try {
          const { stdout, stderr } = await execFileAsync(
            "node",
            [
              "scripts/smoothcomp-sync.mjs",
              "--event-limit=all",
              "--bracket-limit=all",
              "--match-limit=all",
              "--live-score-limit=500"
            ],
            {
              cwd: server.config.root,
              maxBuffer: 50 * 1024 * 1024
            }
          );
          const snapshotText = await readFile("src/generated/smoothcomp-live-snapshot.json", "utf8");

          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ snapshot: JSON.parse(snapshotText), stdout, stderr }));
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
