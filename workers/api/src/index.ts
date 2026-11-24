import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { admin } from "./admin";
import { processAnchors } from "./anchor";
import { auth } from "./auth";
import { generator } from "./generator";
import { HttpError, type App } from "./http";
import { ingest } from "./ingest";
import { listings, trades } from "./market";

const app = new Hono<App>({ strict: false });
const api = new Hono<App>({ strict: false });

api.use(cors({
  origin: (origin) => origin === "https://carbon.vedant-dev.com" || origin === "http://localhost:5183" ||
    /^https:\/\/[a-z0-9-]+\.ucs-carbon\.pages\.dev$/.test(origin) ? origin : undefined,
  allowHeaders: ["Authorization", "Content-Type"],
  allowMethods: ["GET", "POST", "OPTIONS"],
}));
api.use(bodyLimit({
  maxSize: 100 * 1024,
  onError: (c) => c.json({ error: "invalid JSON request body" }, 400),
}));
api.use(async (c, next) => {
  if (c.req.raw.body && /^application\/json(?:\s*;|$)/i.test(c.req.header("Content-Type") ?? "")) {
    try {
      const raw = await c.req.text();
      if (raw) {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== "object") throw new Error("invalid JSON request body");
        c.set("body", value as Record<string, unknown>);
      }
    } catch {
      throw new HttpError(400, "invalid JSON request body");
    }
  }
  await next();
});

api.route("/auth", auth);
api.route("/ingest", ingest);
api.route("/generator", generator);
api.route("/listings", listings);
api.route("/trades", trades);
api.route("/admin", admin);

app.route("/api/v1", api);
app.get("/health", (c) => c.json({ ok: true }));
app.notFound((c) => c.json({ error: "route not found" }, 404));
app.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
  if (/\b(?:UNIQUE|PRIMARY KEY) constraint failed\b/.test(error.message)) return c.json({ error: "record already exists" }, 409);
  if (/\bFOREIGN KEY constraint failed\b/.test(error.message)) return c.json({ error: "record not found" }, 404);
  console.error("Request failed", { method: c.req.method, path: c.req.path, error: error.message.startsWith("D1_ERROR") ? error.message.split("\n", 1)[0] : error.name });
  return c.json({ error: "internal server error" }, 500);
});

export default {
  fetch: app.fetch,
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(processAnchors(env)),
} satisfies ExportedHandler<Env>;
