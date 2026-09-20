import type { WorkersResponse } from "@/lib/apps/types";
import {
  scanBackgroundWorkers,
  toPublicWorker,
} from "@/lib/apps/worker-scanner";
import { validateLocalRequest } from "@/lib/security/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const validationError = validateLocalRequest(request);
  if (validationError) {
    return Response.json({ message: validationError }, { status: 403 });
  }

  try {
    const workers = await scanBackgroundWorkers();
    const payload: WorkersResponse = {
      workers: workers.map(toPublicWorker),
      scannedAt: new Date().toISOString(),
      warnings: [],
    };
    const response = Response.json(payload);
    response.headers.set("cache-control", "no-store, max-age=0");
    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The Windows scan failed.";
    return Response.json({ message }, { status: 500 });
  }
}
