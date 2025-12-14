import type {MiddlewareHandler} from "hono";

const allowedHeaders = [
  "Content-Type",
  "Authorization",
  "X-Requested-With",
  "Accept",
  "Origin",
    "x-proxy-key",
];

export const cors: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "OPTIONS") {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    c.header("Access-Control-Allow-Headers", allowedHeaders.join(","));

    return c.text("", 200);
  }

  await next();

  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  c.header("Access-Control-Allow-Headers", allowedHeaders.join(","));

  return c.res;
};
