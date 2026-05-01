import app from "../../../server/src/index";
import type { Handler } from "@netlify/functions";

export const handler: Handler = async (event, context) => {
  // Reconstruct the full URL, preserving the original path
  const host = event.headers["host"] ?? "localhost";
  const protocol = event.headers["x-forwarded-proto"] ?? "https";
  const path = event.rawUrl
    ? new URL(event.rawUrl).pathname + (new URL(event.rawUrl).search || "")
    : event.path + (event.rawQuery ? `?${event.rawQuery}` : "");

  const url = `${protocol}://${host}${path}`;

  const request = new Request(url, {
    method: event.httpMethod,
    headers: Object.fromEntries(
      Object.entries(event.headers).filter(([, v]) => v !== undefined)
    ) as Record<string, string>,
    body:
      event.body &&
      event.httpMethod !== "GET" &&
      event.httpMethod !== "HEAD" &&
      event.httpMethod !== "OPTIONS"
        ? event.isBase64Encoded
          ? Buffer.from(event.body, "base64")
          : event.body
        : undefined,
  });

  try {
    const response = await app.fetch(request, {
      netlifyContext: context,
    });

    const body = await response.arrayBuffer();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      statusCode: response.status,
      headers,
      body: Buffer.from(body).toString(
        headers["content-type"]?.includes("text") ||
          headers["content-type"]?.includes("json") ||
          headers["content-type"]?.includes("application/")
          ? "utf-8"
          : "base64"
      ),
      isBase64Encoded: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("API function error:", message, err);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: message }),
    };
  }
};
