import { CODEX_OFFICIAL_MARK } from "./codex-mark.js";
import { PLATFORM_ICONS } from "./platform-icons.js";

const paths = {
  codex: '<g fill="currentColor" stroke="none">' + CODEX_OFFICIAL_MARK + '</g>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  "codex-connect": '<g transform="translate(1 5) scale(1.25)" fill="currentColor" stroke="none">' + CODEX_OFFICIAL_MARK + '</g><circle cx="51" cy="23" r="10" fill="var(--accent-soft)" stroke="none"/><g transform="translate(42 14) scale(.75)" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></g>',
  bridge: '<path d="M4 18V9a8 8 0 0 1 16 0v9M4 11h16M8 12v6m8-6v6M2 18h20M12 3v8"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M8 10h8m-8 4h5"/>',
  plug: '<path d="M9 3v5m6-5v5M7 8h10v3a5 5 0 0 1-10 0V8Zm5 8v5"/>',
  unplug: '<path d="m3 3 18 18M9 3v3m6-3v5M7 8h10v3c0 .7-.1 1.3-.4 1.9M7 11a5 5 0 0 0 5 5h1m-1 0v5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M16 6.5h2m-2 11h2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6a8 8 0 0 1 13 3L20 12M4 12l.9 3a8 8 0 0 0 13 3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  bot: '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M1 12v4m22-4v4M8 12h.01M16 12h.01M9 16h6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  compress: '<path d="M4 3v5h5M20 3v5h-5M4 21v-5h5m11 5v-5h-5M3 12h18"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
  shield: '<path d="M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Z"/><path d="m8 12 3 3 5-6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  settings: '<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  loader: '<path d="M21 12a9 9 0 1 1-9-9"/>'
};

export function icon(name) {
  const platform = String(name).startsWith("platform-") ? String(name).slice(9) : "";
  if (Object.hasOwn(PLATFORM_ICONS, platform)) {
    return '<img class="icon platform-icon" src="' + PLATFORM_ICONS[platform].dataUrl + '" width="24" height="24" alt="" aria-hidden="true" draggable="false" />';
  }
  const body = Object.hasOwn(paths, name) ? paths[name] : paths.chat;
  const viewBox = name === "codex-connect" ? "0 0 62 40" : "0 0 24 24";
  return '<svg class="icon' + (name === "loader" ? " icon-spin" : "") + '" viewBox="' + viewBox + '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
}

export function mountIcons(root = document) {
  for (const slot of root.querySelectorAll("[data-icon]")) slot.innerHTML = icon(slot.dataset.icon);
}

export function setIconLabel(element, name, label) {
  element.innerHTML = icon(name);
  element.append(document.createTextNode(label));
}
