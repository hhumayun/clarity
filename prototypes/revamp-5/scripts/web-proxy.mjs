// Sage's web build, to try in a browser away from this machine with sign-in (2026-10-07).
// The live server answers web pages only from the addresses it knows (CORS), and a tunnel's address
// isn't one. So this serves Metro's web build and passes the app's /_api calls on to the server from
// here: to the browser they go to the page's own address. It tells the page so
// (window.__SAGE_API_BASE__ = "", read by src/core/api/apiFetch.ts). Nothing on the server changes.
//
//   node scripts/web-proxy.mjs        PORT (8089), METRO (http://localhost:8087), API (the live server)
//   /opt/cloudflared/cloudflared tunnel --no-autoupdate --url http://localhost:8089
import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.PORT || 8089);
const METRO = new URL(process.env.METRO || "http://localhost:8087");
const API = process.env.API || "https://clarity-notes-production.up.railway.app";
const HINT = '<script>window.__SAGE_API_BASE__ = "";</script>';
// Not passed on: they belong to each connection, or are worked out again.
const HOP = new Set(["host", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "content-length", "origin", "referer"]);

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

const server = http.createServer(async (req, res) => {
  try {
    const toApi = req.url.startsWith("/_api/");
    const target = new URL(req.url, toApi ? API : METRO);
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => !HOP.has(name)));
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const upstream = await fetch(target, { method: req.method, headers, body, redirect: "manual" });
    // fetch has already unpacked the body, so its encoding and length no longer apply.
    const out = Object.fromEntries([...upstream.headers].filter(([name]) => !["content-encoding", "content-length", "transfer-encoding", "connection"].includes(name)));
    if (!toApi && (upstream.headers.get("content-type") ?? "").includes("text/html")) {
      const html = (await upstream.text()).replace(/<head>/i, `<head>${HINT}`);
      res.writeHead(upstream.status, out);
      res.end(html);
      return;
    }
    res.writeHead(upstream.status, out);
    if (upstream.body) for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (error) {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`web-proxy: ${error instanceof Error ? error.message : error}`);
  }
});

// Metro's live-reload socket, passed through as it is.
server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(Number(METRO.port || 80), METRO.hostname, () => {
    const lines = Object.entries(req.headers).map(([name, value]) => `${name}: ${value}`);
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(PORT, () => console.log(`web-proxy on http://localhost:${PORT}: the web build from ${METRO.origin}, /_api from ${API}`));
