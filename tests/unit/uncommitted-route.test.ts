import { beforeEach, describe, expect, test, vi } from "vitest";

const { scanUncommittedProjects } = vi.hoisted(() => ({
  scanUncommittedProjects: vi.fn(),
}));

vi.mock("@/lib/git/uncommitted-scanner", () => ({
  scanUncommittedProjects,
}));

import { GET } from "@/app/api/uncommitted/route";

describe("GET /api/uncommitted", () => {
  beforeEach(() => {
    scanUncommittedProjects.mockReset();
    scanUncommittedProjects.mockResolvedValue({
      projects: [],
      roots: ["C:\\Codex", "C:\\ClaudeCode"],
      warnings: [],
    });
  });

  test("returns a local no-store response", async () => {
    const request = new Request("http://127.0.0.1:43110/api/uncommitted", {
      headers: { host: "127.0.0.1:43110" },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toMatchObject({
      projects: [],
      roots: ["C:\\Codex", "C:\\ClaudeCode"],
      warnings: [],
    });
  });

  test("rejects non-local host headers before scanning", async () => {
    const request = new Request("http://example.com/api/uncommitted", {
      headers: { host: "example.com" },
    });
    const response = await GET(request);

    expect(response.status).toBe(403);
    expect(scanUncommittedProjects).not.toHaveBeenCalled();
  });
});
