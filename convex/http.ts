import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { handleMcpRequest } from "./mcp/handler";
import { validateAuth, unauthorizedResponse } from "./auth";
import { JsonRpcRequest } from "./mcp/types";

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
