import { clearedSessionCookie } from "../../../../lib/server/auth.ts";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const response = Response.redirect(new URL("/", url.origin), 303);
  response.headers.append("set-cookie", clearedSessionCookie(url.protocol === "https:"));
  return response;
}
