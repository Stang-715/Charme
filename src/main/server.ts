import { inspectGlb } from "./assets";
import { open, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Service } from "./service";
export async function startServer(
  service: Service,
  root: string,
  desktopAction?: (name: string) => void,
) {
  const launches = new Map<string, number>(),
    sessions = new Set<string>();
  let origin = "";
  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'self'",
    );
    if (
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin)
    ) {
      json(res, 403, { error: "Request origin rejected" });
      return;
    }
    const url = new URL(req.url ?? "/", origin);
    try {
      const body = async () => {
        let data = "";
        for await (const chunk of req) {
          data += chunk;
          if (Buffer.byteLength(data) > 12_000_000)
            throw Error("Request too large");
        }
        return JSON.parse(data || "{}");
      };
      if (url.pathname === "/api/session" && req.method === "POST") {
        if (req.headers.origin !== origin) throw Error("Origin required");
        const { token } = await body();
        const expires = launches.get(token);
        launches.delete(token);
        if (!expires || Date.now() > expires) {
          json(res, 401, { error: "Reopen Dashboard from Charme" });
          return;
        }
        const session = randomBytes(32).toString("hex");
        sessions.add(session);
        json(res, 200, { session });
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const token = req.headers.authorization?.replace(/^Bearer /, "");
        if (!token || !sessions.has(token)) {
          json(res, 401, { error: "Reopen Dashboard from Charme" });
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/state") {
          json(res, 200, service.snapshot());
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/assets/validate") {
          if (req.headers.origin !== origin) throw Error("Origin required");
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const chunk of req) {
            length += chunk.length;
            if (length > 20_000_000)
              throw Error("GLB must be no larger than 20 MB");
            chunks.push(chunk);
          }
          json(
            res,
            200,
            inspectGlb(
              Buffer.concat(chunks),
              decodeURIComponent(
                String(req.headers["x-asset-name"] ?? "Imported charm"),
              ),
            ),
          );
          return;
        }
        if (req.method === "GET" && url.pathname.startsWith("/api/assets/")) {
          const id = url.pathname.slice("/api/assets/".length);
          if (!service.state.settings.charms?.assets.some((a) => a.id === id))
            throw Error("Unknown asset");
          const bytes = await service.assets.read(id);
          res.writeHead(200, {
            "Content-Type": "model/gltf-binary",
            "Cache-Control": "no-store",
          });
          res.end(bytes);
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/export") {
          res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Cache-Control": "no-store",
          });
          res.end(await service.exportBackup());
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/events") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          const push = (value: unknown) =>
            res.write(`data: ${JSON.stringify(value)}\n\n`);
          push(service.snapshot());
          service.on("state", push);
          req.on("close", () => service.off("state", push));
          return;
        }
        if (req.method === "POST") {
          if (req.headers.origin !== origin) throw Error("Origin required");
          if (
            url.pathname === "/api/assets" ||
            url.pathname === "/api/restore-archive"
          ) {
            const limit =
              url.pathname === "/api/assets" ? 20_000_000 : 270_000_000;
            const tmp = path.join(
              tmpdir(),
              "charme-upload-" + crypto.randomUUID(),
            );
            const file = await open(tmp, "wx", 0o600);
            let length = 0;
            try {
              for await (const chunk of req) {
                length += chunk.length;
                if (length > limit) throw Error("Upload exceeds size limit");
                await file.write(chunk);
              }
              await file.close();
              const bytes = await readFile(tmp);
              if (url.pathname === "/api/assets")
                json(
                  res,
                  200,
                  await service.importAsset(
                    bytes,
                    decodeURIComponent(
                      String(req.headers["x-asset-name"] ?? "Imported charm"),
                    ),
                  ),
                );
              else {
                await service.restoreBackup(bytes);
                json(res, 200, service.snapshot());
              }
            } finally {
              await file.close().catch(() => {});
              await unlink(tmp).catch(() => {});
            }
            return;
          }
          if (url.pathname === "/api/desktop-action") {
            const value = await body();
            if (
              ![
                "position-left",
                "position-right",
                "position-up",
                "position-down",
                "position-center",
                "stop-motion",
                "reset-pose",
                "gust",
              ].includes(value.name)
            )
              throw Error("Unknown desktop action");
            if (!desktopAction)
              throw Error("Desktop controls require the native Charme app");
            desktopAction(value.name);
            json(res, 200, { ok: true });
            return;
          }
          if (url.pathname === "/api/command") {
            json(res, 200, await service.command(await body()));
            return;
          }
          if (url.pathname === "/api/reset") {
            const value = await body();
            if (value.confirmation !== "DELETE ALL CHARME DATA")
              throw Error("Explicit confirmation required");
            await service.resetAll();
            json(res, 200, service.snapshot());
            return;
          }
          if (url.pathname === "/api/restore") {
            await service.restore(await body());
            json(res, 200, service.snapshot());
            return;
          }
        }
        json(res, 404, { error: "Not found" });
        return;
      }
      if (req.method !== "GET") {
        json(res, 405, { error: "Method not allowed" });
        return;
      }
      const relative =
        url.pathname === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname.slice(1));
      const file = path.resolve(root, relative);
      if (!file.startsWith(path.resolve(root) + path.sep))
        throw Error("Invalid asset path");
      const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".glb": "model/gltf-binary",
        ".png": "image/png",
        ".json": "application/json",
        ".woff2": "font/woff2",
      };
      if (!mime[path.extname(file)]) {
        json(res, 404, { error: "Not found" });
        return;
      }
      const bytes = await readFile(file);
      res.writeHead(200, { "Content-Type": mime[path.extname(file)] });
      res.end(bytes);
    } catch (e) {
      json(res, 400, {
        error: e instanceof Error ? e.message : "Request failed",
      });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No dashboard port");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    server,
    origin,
    launchUrl() {
      const token = randomBytes(32).toString("hex");
      launches.set(token, Date.now() + 60000);
      for (const [t, expiry] of launches)
        if (expiry < Date.now()) launches.delete(t);
      return `${origin}/#${token}`;
    },
  };
}
