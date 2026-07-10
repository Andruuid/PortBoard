import { getAppsResponse } from "@/lib/apps/service";
import { validateLocalRequest } from "@/lib/security/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const validationError = validateLocalRequest(request);
  if (validationError) {
    return Response.json({ message: validationError }, { status: 403 });
  }

  try {
    const response = Response.json(await getAppsResponse());
    response.headers.set("cache-control", "no-store, max-age=0");
    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The Windows scan failed.";
    return Response.json({ message }, { status: 500 });
  }
}
