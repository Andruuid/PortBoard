import { describe, expect, test } from "vitest";

import { validateLocalRequest } from "@/lib/security/local-request";

function request(host: string, origin?: string): Request {
  const headers = new Headers({ host });
  if (origin) headers.set("origin", origin);
  return new Request(`http://${host}/api/apps/close`, { headers });
}

describe("localhost request validation", () => {
  test("accepts localhost reads", () => {
    expect(validateLocalRequest(request("127.0.0.1:43110"))).toBeNull();
  });

  test("requires an exact same-origin mutation", () => {
    expect(
      validateLocalRequest(
        request("127.0.0.1:43110", "http://127.0.0.1:43110"),
        { mutation: true },
      ),
    ).toBeNull();
    expect(
      validateLocalRequest(
        request("127.0.0.1:43110", "https://example.com"),
        { mutation: true },
      ),
    ).toMatch(/Cross-origin/);
  });

  test("rejects non-local host headers", () => {
    expect(validateLocalRequest(request("example.com"))).toMatch(/localhost/);
  });
});
