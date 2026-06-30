import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function runRefresh() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--dns-result-order=ipv4first", join(root, "scripts/refresh.mjs")], { cwd: root });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => (code === 0 ? resolve(output) : reject(new Error(output || `refresh exited ${code}`))));
  });
}

createServer(async (req, res) => {
  try {
    if (req.url === "/api/data") {
      return send(res, 200, await readFile(join(publicRoot, "data.json"), "utf8"));
    }
    if (req.url === "/api/refresh" && req.method === "POST") {
      try {
        await runRefresh();
        return send(res, 200, await readFile(join(publicRoot, "data.json"), "utf8"));
      } catch (error) {
        return send(res, 503, JSON.stringify({ error: "Refresh failed; cached data remains available.", detail: error.message }));
      }
    }

    const pathname = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const publicPathname = pathname.startsWith("/public/") ? pathname.slice("/public".length) : pathname;
    const path = normalize(join(pathname === "/index.html" ? root : publicRoot, publicPathname.replace(/^\//, "")));
    if (!path.startsWith(root)) return send(res, 403, "Forbidden", "text/plain");
    const body = await readFile(path);
    return send(res, 200, body, types[extname(path)] || "application/octet-stream");
  } catch {
    return send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Maxshot Fee Monitor: http://127.0.0.1:${port}`);
});
