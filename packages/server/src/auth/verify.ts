import type { IncomingMessage } from "node:http";
import type { User } from "@app/shared";
import { verifyToken } from "./jwt.js";

/** Extract + verify the Bearer token on an HTTP request → User, or null. */
export function userFromReq(req: IncomingMessage): User | null {
  const h = req.headers["authorization"];
  if (!h || Array.isArray(h)) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? verifyToken(m[1]!) : null;
}
