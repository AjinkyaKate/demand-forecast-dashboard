import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";

export const dynamic = "force-dynamic";

function listDir(dir: string, depth = 0): string[] {
  const lines: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const stat = fs.statSync(full);
      const prefix = "  ".repeat(depth);
      if (e.isDirectory()) {
        lines.push(`${prefix}${e.name}/`);
        if (depth < 2) lines.push(...listDir(full, depth + 1));
      } else {
        lines.push(`${prefix}${e.name} (${stat.size} bytes)`);
      }
    }
  } catch (err) {
    lines.push(`  [error reading ${dir}: ${err}]`);
  }
  return lines;
}

export function GET() {
  const cwd = process.cwd();
  const dirname = __dirname;

  const candidates = [
    path.join(cwd, "data", "forecast.db"),
    path.join(cwd, "data"),
    path.resolve(dirname, "..", "..", "..", "..", "data", "forecast.db"),
    path.resolve(dirname, "..", "..", "data", "forecast.db"),
    path.resolve(dirname, "..", "data", "forecast.db"),
    path.resolve(dirname, "data", "forecast.db"),
  ];

  const checks = candidates.map((p) => ({
    path: p,
    exists: fs.existsSync(p),
    isFile: fs.existsSync(p) && fs.statSync(p).isFile(),
    size: fs.existsSync(p) && fs.statSync(p).isFile() ? fs.statSync(p).size : null,
  }));

  return NextResponse.json({
    cwd,
    dirname,
    nodeVersion: process.version,
    platform: process.platform,
    env: {
      VERCEL: process.env.VERCEL,
      VERCEL_ENV: process.env.VERCEL_ENV,
      LAMBDA_TASK_ROOT: process.env.LAMBDA_TASK_ROOT,
    },
    candidates: checks,
    cwdListing: listDir(cwd),
    dirnameListing: listDir(dirname),
  });
}
