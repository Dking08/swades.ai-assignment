import app from "../../apps/server/src/index";

type NetlifyContext = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

export default function handler(request: Request, context: NetlifyContext) {
  return app.fetch(request, { netlifyContext: context });
}

export const config = {
  path: "/api/*",
};
