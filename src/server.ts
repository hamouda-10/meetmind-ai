import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"error":true,"status":500,"unhandled":true} or {"unhandled":true,"message":"HTTPError"}
// try/catch alone never fires for those without response normalization.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const capturedError = consumeLastCapturedError();
  console.error(
    "[SSR Runtime Recovery] Caught swallowed SSR error:",
    capturedError ?? new Error(`Nitro/h3 swallowed SSR error: ${body}`),
  );
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as {
      unhandled?: unknown;
      message?: unknown;
      error?: unknown;
      status?: unknown;
    };
    if (!payload || typeof payload !== "object") return false;
    return Boolean(
      payload.unhandled === true ||
      payload.error === true ||
      payload.status === 500 ||
      payload.message === "HTTPError",
    );
  } catch {
    return false;
  }
}

import { handleApiRequest } from "./server/routes";
import { recoverInterruptedJobs } from "./server/jobs";

// Safely attempt job recovery on server startup without crashing cold starts
try {
  recoverInterruptedJobs();
} catch (err) {
  console.warn("[Jobs] Background recovery skipped during server startup:", err);
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/v1")) {
        const apiResponse = await handleApiRequest(request);
        if (apiResponse) return apiResponse;
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error("[Server Critical Error]:", error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
