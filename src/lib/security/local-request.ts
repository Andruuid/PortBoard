const ALLOWED_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

function parseHost(value: string | null): URL | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(`http://${value}`);
  } catch {
    return null;
  }
}

export function validateLocalRequest(
  request: Request,
  options: { mutation?: boolean } = {},
): string | null {
  const requestHost = parseHost(request.headers.get("host"));

  if (!requestHost || !ALLOWED_HOSTNAMES.has(requestHost.hostname)) {
    return "Portboard only accepts requests addressed to localhost.";
  }

  if (!options.mutation) {
    return null;
  }

  const originValue = request.headers.get("origin");
  if (!originValue) {
    return "A same-origin request is required for this action.";
  }

  try {
    const origin = new URL(originValue);
    const sameHost = origin.host.toLowerCase() === requestHost.host.toLowerCase();
    const allowedOrigin =
      origin.protocol === "http:" && ALLOWED_HOSTNAMES.has(origin.hostname);

    if (!sameHost || !allowedOrigin) {
      return "Cross-origin process actions are not allowed.";
    }
  } catch {
    return "The request origin is invalid.";
  }

  return null;
}
