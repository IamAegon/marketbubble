/** Tiny pub/sub so a toast (or anywhere) can ask the live feed to scroll to a
 * specific message id. Decouples the global toast layer from the feed view. */
type Fn = (id: string) => void;
const subs = new Set<Fn>();

export function onJump(fn: Fn): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
export function jumpToMessage(id: string): void {
  for (const fn of subs) fn(id);
}
