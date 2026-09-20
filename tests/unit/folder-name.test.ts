import { describe, expect, test } from "vitest";

import { folderDisplayName } from "@/lib/apps/folder-name";

describe("folderDisplayName", () => {
  test("returns the last Windows folder segment", () => {
    expect(folderDisplayName("C:\\Codex\\PortsMaster")).toBe("PortsMaster");
  });

  test("strips a trailing slash before taking the last segment", () => {
    expect(folderDisplayName("C:\\Codex\\PortsMaster\\")).toBe("PortsMaster");
    expect(folderDisplayName("C:/Codex/PortsMaster/")).toBe("PortsMaster");
  });

  test("handles mixed slashes", () => {
    expect(folderDisplayName("C:/Codex\\PortsMaster")).toBe("PortsMaster");
  });

  test("returns a dash when the folder is missing", () => {
    expect(folderDisplayName(null)).toBe("—");
    expect(folderDisplayName("")).toBe("—");
    expect(folderDisplayName("///")).toBe("—");
  });
});
