import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discoverGitRepositories: vi.fn(),
  getRepositoryId: vi.fn((directory: string) =>
    directory.endsWith("AllowedProject") ? "a".repeat(20) : "b".repeat(20),
  ),
  openDirectoryInVSCode: vi.fn(),
}));

vi.mock("@/lib/git/uncommitted-scanner", () => ({
  discoverGitRepositories: mocks.discoverGitRepositories,
  getRepositoryId: mocks.getRepositoryId,
}));

vi.mock("@/lib/git/vscode", () => ({
  openDirectoryInVSCode: mocks.openDirectoryInVSCode,
}));

import { POST } from "@/app/api/uncommitted/open/route";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1:43110/api/uncommitted/open", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:43110",
      origin: "http://127.0.0.1:43110",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/uncommitted/open", () => {
  beforeEach(() => {
    mocks.discoverGitRepositories.mockReset();
    mocks.discoverGitRepositories.mockResolvedValue({
      repositories: ["C:\\Codex\\AllowedProject"],
      warnings: [],
    });
    mocks.getRepositoryId.mockClear();
    mocks.openDirectoryInVSCode.mockReset();
    mocks.openDirectoryInVSCode.mockResolvedValue(undefined);
  });

  test("opens only the server-resolved repository directory", async () => {
    const response = await POST(
      request({ id: "a".repeat(20), directory: "C:\\Windows" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.openDirectoryInVSCode).toHaveBeenCalledOnce();
    expect(mocks.openDirectoryInVSCode).toHaveBeenCalledWith(
      "C:\\Codex\\AllowedProject",
    );
    await expect(response.json()).resolves.toMatchObject({ opened: true });
  });

  test("rejects an expired or unknown project identifier", async () => {
    const response = await POST(request({ id: "z".repeat(20) }));

    expect(response.status).toBe(409);
    expect(mocks.openDirectoryInVSCode).not.toHaveBeenCalled();
  });

  test("rejects cross-origin requests before repository discovery", async () => {
    const response = await POST(
      request({ id: "a".repeat(20) }, { origin: "http://example.com" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.discoverGitRepositories).not.toHaveBeenCalled();
    expect(mocks.openDirectoryInVSCode).not.toHaveBeenCalled();
  });

  test("rejects malformed project identifiers", async () => {
    const response = await POST(request({ id: "short" }));

    expect(response.status).toBe(400);
    expect(mocks.discoverGitRepositories).not.toHaveBeenCalled();
  });
});
