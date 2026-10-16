const STORAGE_KEY = "bridge-appearance";
const choices = new Set(["light", "dark", "system"]);

export function resolveTheme(preference, darkSystem = false) {
  return preference === "dark" || preference === "system" && darkSystem ? "dark" : "light";
}

export function initializeTheme(doc = document, storage, media = window.matchMedia("(prefers-color-scheme: dark)")) {
  let preference = "light";
  try { storage ??= globalThis.localStorage; const saved = storage.getItem(STORAGE_KEY); if (choices.has(saved)) preference = saved; } catch { /* Storage can be disabled. */ }
  const select = doc.getElementById("theme-select");
  function apply(value) {
    preference = choices.has(value) ? value : "light";
    doc.documentElement.dataset.theme = resolveTheme(preference, media.matches);
    if (select) select.value = preference;
  }
  apply(preference);
  select?.addEventListener("change", () => {
    apply(select.value);
    try { storage.setItem(STORAGE_KEY, preference); } catch { /* Keep this tab usable without storage. */ }
  });
  media.addEventListener("change", () => { if (preference === "system") apply(preference); });
}

if (typeof document !== "undefined") initializeTheme();
