import { validateLocalRequest } from "@/lib/security/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const validationError = validateLocalRequest(request);
  if (validationError) {
    return Response.json({ message: validationError }, { status: 403 });
  }

  return Response.json({ status: "ok" });
}
