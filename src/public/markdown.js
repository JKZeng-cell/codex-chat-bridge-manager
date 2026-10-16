export function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function inline(value, depth = 0) {
  if (depth > 3) return escapeHtml(value);
  const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^\s)]+)\)|\*([^*\n]+)\*/g;
  let result = "";
  let end = 0;
  for (const match of value.matchAll(pattern)) {
    result += escapeHtml(value.slice(end, match.index));
    if (match[1] != null) result += "<code>" + escapeHtml(match[1]) + "</code>";
    else if (match[2] != null) result += "<strong>" + inline(match[2], depth + 1) + "</strong>";
    else if (match[3] != null) {
      let safe = false;
      try { safe = ["http:", "https:"].includes(new URL(match[4]).protocol); } catch { /* Keep unsupported links as text. */ }
      result += safe ? '<a href="' + escapeHtml(match[4]) + '" target="_blank" rel="noopener noreferrer">' + inline(match[3], depth + 1) + "</a>" : escapeHtml(match[0]);
    } else result += "<em>" + inline(match[5], depth + 1) + "</em>";
    end = match.index + match[0].length;
  }
  return result + escapeHtml(value.slice(end));
}

const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
const separator = (line) => cells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
const blockStart = (line) => /^(?:\s*```|#{1,6}\s|\s*[-*+]\s|\s*\d+\.\s|>\s?|\s*(?:---+|\*\*\*+)\s*$)/.test(line);

// Render a conservative Markdown subset; raw HTML and non-web links stay inert.
export function renderMarkdown(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const language = line.replace(/^\s*```/, "").trim().slice(0, 30);
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push('<div class="code-block"><div class="code-heading"><span>' + escapeHtml(language || "代码") + '</span><button class="text-button" data-copy-code type="button">复制代码</button></div><pre><code>' + escapeHtml(code.join("\n")) + "</code></pre></div>");
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { const level = heading[1].length; blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`); i++; continue; }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) { blocks.push("<hr />"); i++; continue; }
    if (line.includes("|") && i + 1 < lines.length && separator(lines[i + 1]) && lines[i + 1].includes("|")) {
      const headers = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push('<div class="markdown-table"><table><thead><tr>' + headers.map((cell) => "<th>" + inline(cell) + "</th>").join("") + "</tr></thead><tbody>" + rows.map((row) => "<tr>" + headers.map((_, index) => "<td>" + inline(row[index] || "") + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>");
      continue;
    }
    const list = line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
    if (list) {
      const ordered = list[2] != null;
      const items = [];
      while (i < lines.length) {
        const next = lines[i].match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
        if (!next || (next[2] != null) !== ordered) break;
        items.push("<li>" + inline(next[3]) + "</li>"); i++;
      }
      const tag = ordered ? "ol" : "ul";
      const start = ordered && Number(list[2]) !== 1 ? ' start="' + Number(list[2]) + '"' : "";
      blocks.push(`<${tag}${start}>${items.join("")}</${tag}>`);
      continue;
    }
    if (/^>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>/.test(lines[i])) quote.push(inline(lines[i++].replace(/^>\s?/, "")));
      blocks.push("<blockquote>" + quote.join("<br />") + "</blockquote>"); continue;
    }
    const paragraph = [inline(line)];
    i++;
    while (i < lines.length && lines[i].trim() && !blockStart(lines[i])) {
      if (lines[i].includes("|") && i + 1 < lines.length && separator(lines[i + 1])) break;
      paragraph.push(inline(lines[i++]));
    }
    blocks.push("<p>" + paragraph.join("<br />") + "</p>");
  }
  return blocks.join("\n");
}
