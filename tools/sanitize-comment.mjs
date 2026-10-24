// Makes model output safe to post as a pull request comment. Reads stdin, writes stdout.
// Usage: node tools/sanitize-comment.mjs [max-characters]
// Removes HTML (tags and comments), markdown images and links to hosts other than this GitHub instance,
// neutralizes @mentions and caps the length. The output is data to read, never markup to render.
import { readFileSync } from 'node:fs';

const max = Number(process.argv[2]) || 20000;
const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
const trusted = new Set([new URL(serverUrl).host, 'github.com']);

const isTrusted = (url) => {
  try {
    return trusted.has(new URL(url).host);
  } catch {
    return false;
  }
};
const code = (url) => '`' + url.replace(/`/g, '') + '`';

let text = readFileSync(0, 'utf8').replace(/\r\n/g, '\n');

// HTML comments and tags.
text = text.replace(/<!--[\s\S]*?-->/g, '');
text = text.replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?\/?>/g, '');
// Markdown images, inline and reference style.
text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '[image removed]');
text = text.replace(/!\[[^\]]*\]\[[^\]]*\]/g, '[image removed]');
// Markdown links to other hosts become plain text followed by the URL as code.
text = text.replace(
  /\[([^\]]*)\]\(\s*<?(https?:\/\/[^)\s>]+)>?[^)]*\)/g,
  (match, label, url) => (isTrusted(url) ? match : `${label} (${code(url)})`),
);
// Reference definitions.
text = text.replace(/^\s*\[[^\]]+\]:\s*(https?:\/\/\S+).*$/gm, (line, url) =>
  isTrusted(url) ? line : code(url),
);
// Bare URLs that are not already inside backticks or a trusted link.
text = text.replace(
  /(`[^`\n]*`)|(\]\()?(https?:\/\/[^\s)<>`]+)/g,
  (match, inCode, inLink, url) => {
    if (inCode || inLink) return match;
    return isTrusted(url) ? match : code(url);
  },
);
// Mentions and team mentions: insert a zero-width space after the @.
text = text.replace(/@(?=[A-Za-z0-9_])/g, '@​');

if (text.length > max) text = text.slice(0, max) + '\n\n_(output truncated)_';
process.stdout.write(text.trim() + '\n');
