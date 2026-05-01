import app from "../../../server/src/index";
import type { Handler } from "@netlify/functions";

// Adapt Hono's Web API response to Netlify's legacy handler format
export const handler: Handler = async (event) => {
  const url = new URL(
    event.path,
    `https://${event.headers.host ?? "localhost"}`
  );

  // Rebuild query string
  if (event.queryStringParameters) {
    for (const [key, value] of Object.entries(event.queryStringParameters)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }

  const request = new Request(url.toString(), {
    method: event.httpMethod,
    headers: event.headers as Record<string, string>,
    body:
      event.body && event.httpMethod !== "GET" && event.httpMethod !== "HEAD"
        ? event.isBase64Encoded
          ? Buffer.from(event.body, "base64")
          : event.body
        : undefined,
  });

  const response = await app.fetch(request);

  const body = await response.text();
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    statusCode: response.status,
    headers,
    body,
  };
};
