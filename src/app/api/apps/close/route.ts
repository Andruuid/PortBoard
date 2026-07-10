import { closeRunningApp } from "@/lib/apps/service";
import { validateLocalRequest } from "@/lib/security/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const validationError = validateLocalRequest(request, { mutation: true });
  if (validationError) {
    return Response.json({ message: validationError }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "A JSON request body is required." }, { status: 400 });
  }

  const id =
    typeof body === "object" && body !== null && "id" in body
      ? (body as { id?: unknown }).id
      : null;

  if (typeof id !== "string" || id.length < 20 || id.length > 128) {
    return Response.json({ message: "The app fingerprint is invalid." }, { status: 400 });
  }

  try {
    const result = await closeRunningApp(id);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The stop operation failed.";
    return Response.json({ message }, { status: 500 });
  }
}
