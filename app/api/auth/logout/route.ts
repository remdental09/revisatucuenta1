import { clearedSessionCookie } from "../../../../lib/server/auth.ts";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const headers = new Headers({
    Location: new URL("/", url.origin).toString(),
    "Cache-Control": "no-store",
  });
  headers.append("set-cookie", clearedSessionCookie(url.protocol === "https:"));
  const response = new Response(null, { status: 303, headers });
  return response;
}
