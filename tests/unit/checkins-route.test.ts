import { beforeEach, describe, expect, test, vi } from "vitest";

const { scanCheckins } = vi.hoisted(() => ({
  scanCheckins: vi.fn(),
}));

vi.mock("@/lib/git/checkins-scanner", () => ({
  scanCheckins,
}));

import { GET } from "@/app/api/checkins/route";

function localRequest() {
  return new Request("http://127.0.0.1:43110/api/checkins", {
    headers: { host: "127.0.0.1:43110" },
  });
}

describe("GET /api/checkins", () => {
  beforeEach(() => {
    scanCheckins.mockReset();
    scanCheckins.mockResolvedValue({
      days: [],
      totals: { commits: 0, added: 0, removed: 0 },
      repositoriesScanned: 0,
      roots: ["C:\\Codex", "C:\\ClaudeCode"],
      warnings: [],
    });
  });

  test("returns a local no-store response", async () => {
    const response = await GET(localRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toMatchObject({
      days: [],
      totals: { commits: 0, added: 0, removed: 0 },
      roots: ["C:\\Codex", "C:\\ClaudeCode"],
      warnings: [],
    });
  });

  test("rejects non-local host headers before scanning", async () => {
    const response = await GET(
      new Request("http://example.com/api/checkins", {
        headers: { host: "example.com" },
      }),
    );

    expect(response.status).toBe(403);
    expect(scanCheckins).not.toHaveBeenCalled();
  });

  test("reports scan failures as a 500 with a message", async () => {
    scanCheckins.mockRejectedValue(new Error("boom"));

    const response = await GET(localRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ message: "boom" });
  });
});
