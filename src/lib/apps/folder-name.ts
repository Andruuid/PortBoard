export function folderDisplayName(projectRoot: string | null | undefined): string {
  if (!projectRoot) return "—";

  const trimmed = projectRoot.replace(/[\\/]+$/, "");
  if (!trimmed) return "—";

  const segments = trimmed.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? "—";
}
