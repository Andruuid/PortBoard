import type { OpenProjectResponse } from "@/lib/git/types";
import {
  discoverGitRepositories,
  getRepositoryId,
} from "@/lib/git/uncommitted-scanner";
import { openDirectoryInVSCode } from "@/lib/git/vscode";
import { validateLocalRequest } from "@/lib/security/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const validationError = validateLocalRequest(request, { mutation: true });
  if (validationError) {
    return Response.json({ message: validationError }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "A JSON request body is required." }, { status: 400 });
  }

  const id =
    typeof body === "object" && body !== null && "id" in body
      ? (body as { id?: unknown }).id
      : null;
  if (typeof id !== "string" || id.length !== 20) {
    return Response.json({ message: "The project identifier is invalid." }, { status: 400 });
  }

  try {
    const discovery = await discoverGitRepositories();
    const directory = discovery.repositories.find(
      (repository) => getRepositoryId(repository) === id,
    );
    if (!directory) {
      return Response.json(
        { message: "This project is no longer available under the allowed roots." },
        { status: 409 },
      );
    }

    await openDirectoryInVSCode(directory);
    const payload: OpenProjectResponse = {
      opened: true,
      message: `Opened ${pathName(directory)} in Visual Studio Code.`,
    };
    return Response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Visual Studio Code could not be opened.";
    return Response.json({ opened: false, message }, { status: 500 });
  }
}

function pathName(directory: string): string {
  const parts = directory.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts.at(-1) || directory;
}
