import { auth } from "@test-evals/auth";
import { env } from "@test-evals/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import runs from "./routes/runs";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// Auth routes (kept but not required for eval endpoints)
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Eval API routes — no auth required
app.route("/api/v1", runs);

// Health check
app.get("/", (c) => {
  return c.json({ status: "OK", version: "1.0.0" });
});

export default app;
