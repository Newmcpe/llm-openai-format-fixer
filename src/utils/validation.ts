import type { HonoRequest } from "hono";

type JsonReadableRequest = Pick<Request, "json"> | Pick<HonoRequest, "json">;

export const readJsonBody = async <T>(request: JsonReadableRequest): Promise<T | Record<string, unknown>> => {
  try {
    return (await request.json()) as T;
  } catch {
    return {};
  }
};

export const pickString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

export const pickValue = <T>(data: unknown, key: string, fallback: T): T => {
  if (data && typeof data === "object" && key in (data as Record<string, unknown>)) {
    return ((data as Record<string, unknown>)[key] as T) ?? fallback;
  }

  return fallback;
};
