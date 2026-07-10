import type { UncommittedResponse } from "@/lib/git/types";
import { scanUncommittedProjects } from "@/lib/git/uncommitted-scanner";
import { validateLocalRequest } from "@/lib/security/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let scanInFlight: ReturnType<typeof scanUncommittedProjects> | null = null;

async function getScan() {
  if (!scanInFlight) {
    scanInFlight = scanUncommittedProjects().finally(() => {
      scanInFlight = null;
    });
  }
  return scanInFlight;
}

export async function GET(request: Request): Promise<Response> {
  const validationError = validateLocalRequest(request);
  if (validationError) {
    return Response.json({ message: validationError }, { status: 403 });
  }

  try {
    const scan = await getScan();
    const payload: UncommittedResponse = {
      projects: scan.projects,
      scannedAt: new Date().toISOString(),
      roots: scan.roots,
      warnings: scan.warnings,
    };
    const response = Response.json(payload);
    response.headers.set("cache-control", "no-store, max-age=0");
    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The Git repository scan failed.";
    return Response.json({ message }, { status: 500 });
  }
}
