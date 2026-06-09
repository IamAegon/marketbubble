// Dependency-free emoji picker — a curated set (trader-flavored "Hype" group first)
// grouped into categories. Unicode emojis send fine to MB, Twitch and Kick alike.
const EMOJI: { cat: string; list: string[] }[] = [
  { cat: "Hype", list: ["🚀", "📈", "📉", "💰", "🤑", "💎", "🙌", "🔥", "⚡", "💸", "🐂", "🐻", "🎯", "🏆", "✅", "❌", "‼️", "👀", "🤝", "🧠", "💯", "🆙"] },
  { cat: "Smileys", list: ["😀", "😃", "😄", "😁", "😅", "😂", "🤣", "🙂", "😉", "😊", "😍", "😎", "🤔", "😐", "😴", "😭", "😡", "🤯", "🥳", "🤡", "💀", "👻", "🥶", "🤓"] },
  { cat: "Gestures", list: ["👍", "👎", "👏", "🙏", "🤙", "✌️", "🤞", "👌", "🤌", "💪", "🫡", "🫶", "👋", "✊", "👊", "🤝"] },
  { cat: "Hearts", list: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "❣️", "💕", "💖"] },
  { cat: "Objects", list: ["💬", "🎉", "🎁", "📌", "🔔", "⭐", "🌟", "💡", "📊", "📰", "🕹️", "🎮", "🍕", "☕", "🍻", "🎲", "📺", "⏰"] },
  { cat: "Animals", list: ["🐂", "🐻", "🐶", "🐱", "🦍", "🐸", "🐵", "🦄", "🐉", "🐧", "🦅", "🐳"] },
];

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="emoji-pop">
      <div className="emoji-scroll">
        {EMOJI.map((g) => (
          <div key={g.cat}>
            <div className="emoji-cat">{g.cat}</div>
            <div className="emoji-grid">
              {g.list.map((e) => (
                <button type="button" key={e} className="emoji-btn" onClick={() => onPick(e)} title={e}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
