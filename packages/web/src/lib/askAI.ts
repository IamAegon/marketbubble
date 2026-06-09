import { useNavigate } from "react-router-dom";

/** Navigate to the Assistant and auto-ask about something (a tweet, a headline, …).
 * The Assistant reads `location.state.ask`, opens a fresh chat, and sends it. */
export function useAskAI() {
  const nav = useNavigate();
  return (prompt: string) => nav("/app/assistant", { state: { ask: prompt } });
}

/** Build the prompt for "ask AI about this tweet". */
export function tweetAskPrompt(p: { author?: { username?: string; displayName?: string }; text: string; link?: string }): string {
  const handle = p.author?.username ? `@${p.author.username}` : "someone";
  const name = p.author?.displayName && p.author.displayName !== p.author?.username ? `${p.author.displayName} (${handle})` : handle;
  return `Here's a tweet from ${name}:\n\n"${p.text}"\n${p.link ?? ""}\n\nWhat is this about, why does it matter for our markets/crypto audience, and what's the bull vs bear take? Keep it tight.`;
}

/** Build the prompt for "ask AI about this headline". */
export function newsAskPrompt(a: { title: string; source: string; url?: string }): string {
  return `Here's a headline from ${a.source}:\n\n"${a.title}"\n${a.url ?? ""}\n\nWhat is this about, why does it matter, and what's the take for our audience? Keep it tight.`;
}
