import type { TeamEvent } from "@app/shared";

/** Tiny pub/sub for broadcast team events (checklist completions etc.). The
 * socket emits here; toasts and the checklist view subscribe. */
type Fn = (e: TeamEvent) => void;
const subs = new Set<Fn>();

export function onTeamEvent(fn: Fn): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
export function emitTeamEvent(e: TeamEvent): void {
  for (const fn of subs) fn(e);
}
