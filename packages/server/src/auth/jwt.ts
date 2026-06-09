import jwt from "jsonwebtoken";
import type { User } from "@app/shared";
import { logger } from "../observability/logger.js";

const SECRET = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
if (!process.env.AUTH_SECRET) {
  logger.warn("AUTH_SECRET is not set — using an insecure default. Set it before deploying; anyone could otherwise forge admin tokens.");
}

export function signToken(user: User): string {
  return jwt.sign(
    { id: user.id, handle: user.handle, displayName: user.displayName, color: user.color, role: user.role },
    SECRET,
    { expiresIn: "30d" },
  );
}

export function verifyToken(token: string): User | null {
  try {
    const d = jwt.verify(token, SECRET) as any;
    if (!d?.id || !d?.handle) return null;
    return { id: d.id, handle: d.handle, displayName: d.displayName, color: d.color, role: d.role ?? "user" };
  } catch {
    return null;
  }
}
