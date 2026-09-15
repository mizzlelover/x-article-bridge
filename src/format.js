const ALLOWED_TAGS = new Set([
  "A", "B", "BLOCKQUOTE", "BR", "CODE", "EM", "H2", "H3", "H4", "HR",
  "I", "LI", "OL", "P", "PRE", "S", "STRONG", "UL", "IMG"
]);

const ALLOWED_STYLE_PROPERTIES = new Set(["text-align"]);

function escapeHtml(value) {
  return value.replace(/[&<>\"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
  }[character]));
}

function safeHref(value) {
  try {
    const url = new URL(value, document.baseURI);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function safeStyle(value) {
  return value.split(";").map((rule) => rule.trim()).filter(Boolean).map((rule) => {
    const [property, ...parts] = rule.split(":");
    const normalized = property.trim().toLowerCase();
    return ALLOWED_STYLE_PROPERTIES.has(normalized) ? `${normalized}:${parts.join(":").trim()}` : "";
  }).filter(Boolean).join(";");
}

function imageName(source, index) {
  if (source.startsWith("data:")) return `article-image-${index + 1}.png`;
  const match = source.match(/[^/\\?#]+(?:\?[^#]*)?$/);
  const name = match?.[0]?.split("?")[0];
  return name || `article-image-${index + 1}.png`;
}

function normalizeHtml(source) {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const assets = [];
  const title = parsed.querySelector("h1")?.textContent?.trim() || parsed.title.trim();
  const titleNode = parsed.querySelector("h1");
  let imageIndex = 0;

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || "");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node;
    const tag = element.tagName;
    if (tag === "H1" || element === titleNode) return "";
    if (!ALLOWED_TAGS.has(tag)) return Array.from(element.childNodes).map(walk).join("");
    if (tag === "IMG") {
      const sourceUrl = element.getAttribute("src")?.trim() || "";
      if (!sourceUrl) return "";
      const marker = `XABIMG${imageIndex}`;
      assets.push({ marker, source: sourceUrl, name: imageName(sourceUrl, imageIndex), alt: element.getAttribute("alt") || "" });
      imageIndex += 1;
      return marker;
    }
    const attributes = [];
    if (tag === "A") {
      const href = safeHref(element.getAttribute("href") || "");
      if (href) attributes.push(` href="${escapeHtml(href)}"`);
    }
    if (["P", "H2", "H3", "H4"].includes(tag)) {
      const style = safeStyle(element.getAttribute("style") || "");
      if (style) attributes.push(` style="${escapeHtml(style)}"`);
    }
    return `<${tag.toLowerCase()}${attributes.join("")}>${Array.from(element.childNodes).map(walk).join("")}</${tag.toLowerCase()}>`;
  };

  const body = Array.from(parsed.body.childNodes).map(walk).join("").trim();
  return { title, html: body, assets };
}

function markdownToHtml(source) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;
  let title = "";
  let imageIndex = 0;

  const inline = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => `XABIMG${imageIndex++}`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");

  const flushParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(`<${list.type}>${list.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${list.type}>`);
    list = null;
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    const unordered = line.match(/^[-*+]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    if (heading) {
      flushParagraph();
      flushList();
      if (line.startsWith("# ") && !title) { title = heading[1].trim(); continue; }
      blocks.push(`<h2>${inline(heading[1])}</h2>`);
      continue;
    }
    if (unordered || ordered) {
      flushParagraph();
      const type = unordered ? "ul" : "ol";
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((unordered || ordered)[1]);
      continue;
    }
    if (line.startsWith("> ")) { flushParagraph(); flushList(); blocks.push(`<blockquote>${inline(line.slice(2))}</blockquote>`); continue; }
    flushList(); paragraph.push(line.trim());
  }
  flushParagraph(); flushList();
  const assets = [...source.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)].map((match, index) => ({ marker: `XABIMG${index}`, source: match[2], name: imageName(match[2], index), alt: match[1] }));
  return { title, html: blocks.join(""), assets };
}

function extractDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/);
  if (!match) return null;
  const mime = match[1];
  const bytes = match[2] ? Uint8Array.from(atob(match[3]), (character) => character.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(match[3]));
  return { mime, bytes };
}
