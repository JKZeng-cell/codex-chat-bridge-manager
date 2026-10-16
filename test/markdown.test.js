import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../src/public/markdown.js";

test("conversation Markdown renders headings, emphasis, lists, quotes and tables", () => {
  const html = renderMarkdown("## Result\n\n**Ready** with `codex`\n\n- One\n- Two\n\n1. First\n2. Second\n\n> Note\n\n| Name | Status |\n| --- | --- |\n| Demo | Ready |");
  for (const tag of ["<h2>Result</h2>", "<strong>Ready</strong>", "<code>codex</code>", "<ul>", "<ol>", "<blockquote>", "<table>", "<td>Ready</td>"]) assert.ok(html.includes(tag), tag);
});

test("raw HTML, unsafe links, and code blocks cannot inject executable markup", () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert) [y](data:text/html,test)\n\n```html\n<img src=x onerror="alert(1)">\n```');
  assert.doesNotMatch(html, /<script|<img|href="(?:javascript|data):/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /data-copy-code/);
});

test("web links have safe attributes and unclosed fences preserve their content", () => {
  assert.match(renderMarkdown('[Docs](https://example.com/?q="hello")'), /rel="noopener noreferrer"/);
  assert.match(renderMarkdown('[Docs](https://example.com/?q="hello")'), /&quot;hello&quot;/);
  assert.match(renderMarkdown("```js\nconst x = 1;"), /const x = 1;/);
  assert.equal(renderMarkdown(""), "");
});
