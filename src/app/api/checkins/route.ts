import { scanCheckins } from "@/lib/git/checkins-scanner";
import type { CheckinsResponse } from "@/lib/git/types";
import { validateLocalRequest } from "@/lib/security/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let scanInFlight: ReturnType<typeof scanCheckins> | null = null;

async function getScan() {
  if (!scanInFlight) {
    scanInFlight = scanCheckins().finally(() => {
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
    const payload: CheckinsResponse = {
      ...scan,
      scannedAt: new Date().toISOString(),
    };
    const response = Response.json(payload);
    response.headers.set("cache-control", "no-store, max-age=0");
    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The commit history scan failed.";
    return Response.json({ message }, { status: 500 });
  }
}
