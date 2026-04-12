export async function validateAuth(request: Request): Promise<boolean> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const token = authHeader.slice(7);
  const expected = process.env.MEMORY_AUTH_TOKEN;
  if (!expected) {
    // If no token configured, reject all requests
    return false;
  }
  return token === expected;
}

export function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    }),
    { status: 401, headers: { "Content-Type": "application/json" } }
  );
}
