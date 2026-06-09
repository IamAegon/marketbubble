// minimal, safe markdown → html (escape first, then bold/italic/code/lists/headers)
export function mdToHtml(src: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    s
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>");
  const out: string[] = [];
  let ul = false;
  let ol = false;
  const close = () => {
    if (ul) {
      out.push("</ul>");
      ul = false;
    }
    if (ol) {
      out.push("</ol>");
      ol = false;
    }
  };
  for (const raw of esc(src).split("\n")) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (/^#{1,4}\s+/.test(line)) {
      close();
      out.push(`<h4>${inline(line.replace(/^#{1,4}\s+/, ""))}</h4>`);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
      if (!ul) {
        close();
        out.push("<ul>");
        ul = true;
      }
      out.push(`<li>${inline(m[1]!)}</li>`);
    } else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) {
      if (!ol) {
        close();
        out.push("<ol>");
        ol = true;
      }
      out.push(`<li>${inline(m[1]!)}</li>`);
    } else if (line === "") {
      close();
    } else {
      close();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  return out.join("");
}
