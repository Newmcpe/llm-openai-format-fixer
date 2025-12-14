import type { MiddlewareHandler } from "hono";
import { buildErrorResponse } from "../utils/response";

export const errorHandler: MiddlewareHandler = async (c, next) => {
  try {
    await next();
  } catch (error) {
    console.error("Unhandled error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";

    return c.json(buildErrorResponse(message), 500);
  }

  return c.res;
};
