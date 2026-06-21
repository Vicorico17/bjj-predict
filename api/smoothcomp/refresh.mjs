import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OUTPUT_PATH = path.join(os.tmpdir(), "smoothcomp-live-snapshot.json");

export default async function handler(req, res) {
  if (req.method === "GET") {
    res.status(200).json({
      status: "idle",
      startedAt: null,
      finishedAt: null,
      snapshot: null,
      error: "",
      stdout: "",
      stderr: ""
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const startedAt = new Date().toISOString();

  try {
    const previousSnapshotText = await readFile(
      path.join(process.cwd(), "src/generated/smoothcomp-live-snapshot.json"),
      "utf8"
    );
    const previousSnapshot = JSON.parse(previousSnapshotText);
    const eventUrls = Array.isArray(previousSnapshot.events)
      ? previousSnapshot.events.map((event) => event?.sourceUrl).filter(Boolean)
      : [];

    if (eventUrls.length === 0) {
      res.status(500).json({ status: "error", error: "No Smoothcomp events are available to refresh." });
      return;
    }

    const { stdout, stderr } = await execFileAsync(
      "node",
      [
        "scripts/smoothcomp-sync.mjs",
        "--out",
        OUTPUT_PATH,
        "--event-limit=all",
        "--bracket-limit=all",
        "--match-limit=all",
        "--live-score-limit=500",
        ...eventUrls.flatMap((url) => ["--event", url])
      ],
      {
        cwd: process.cwd(),
        maxBuffer: 50 * 1024 * 1024,
        timeout: 280000
      }
    );
    const snapshotText = await readFile(OUTPUT_PATH, "utf8");

    res.status(200).json({
      status: "complete",
      startedAt,
      finishedAt: new Date().toISOString(),
      snapshot: JSON.parse(snapshotText),
      stdout: stdout.slice(-4000),
      stderr: stderr.slice(-4000)
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
