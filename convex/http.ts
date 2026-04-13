import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { handleMcpRequest } from "./mcp/handler";
import { validateAuth, unauthorizedResponse } from "./auth";
import { JsonRpcRequest } from "./mcp/types";
import { DASHBOARD_HTML } from "./dashboardPage";

const http = httpRouter();

http.route({
  path: "/mcp",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Auth check
    if (!(await validateAuth(request))) {
      return unauthorizedResponse();
    }

    // Parse JSON-RPC request
    let body: JsonRpcRequest | JsonRpcRequest[];
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32700, message: "Parse error" },
          id: null,
        }),
        { status: 400, headers: corsHeaders("application/json") }
      );
    }

    // Handle batch requests
    if (Array.isArray(body)) {
      const responses = await Promise.all(
        body.map((req) => handleMcpRequest(ctx, req))
      );
      return new Response(JSON.stringify(responses), {
        status: 200,
        headers: corsHeaders("application/json"),
      });
    }

    // Handle single request
    const response = await handleMcpRequest(ctx, body);
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: corsHeaders("application/json"),
    });
  }),
});

// Handle CORS preflight for MCP clients
http.route({
  path: "/mcp",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }),
});

// Health check endpoint
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(JSON.stringify({ status: "ok", server: "pai-memory" }), {
      status: 200,
      headers: corsHeaders("application/json"),
    });
  }),
});

// Dashboard page
http.route({
  path: "/dashboard",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(DASHBOARD_HTML, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }),
});

// Dashboard API — data endpoint
http.route({
  path: "/api/data",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!(await validateAuth(request))) {
      return unauthorizedResponse();
    }

    const url = new URL(request.url);
    const table = url.searchParams.get("table") ?? "memories";
    const type = url.searchParams.get("type") ?? undefined;
    const project = url.searchParams.get("project") ?? undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "200");

    const data = await ctx.runQuery(api.dashboard.getData, {
      table,
      type,
      project,
      limit,
    });

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: corsHeaders("application/json"),
    });
  }),
});

// Dashboard API — stats endpoint
http.route({
  path: "/api/stats",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!(await validateAuth(request))) {
      return unauthorizedResponse();
    }

    const stats = await ctx.runQuery(api.prune.getStorageStats, {});
    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: corsHeaders("application/json"),
    });
  }),
});

function corsHeaders(contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Accept, Mcp-Session-Id",
  };
  if (contentType) {
    headers["Content-Type"] = contentType;
  }
  return headers;
}

export default http;
