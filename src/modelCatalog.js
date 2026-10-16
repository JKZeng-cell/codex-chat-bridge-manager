import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function readModelCatalog(
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex")
) {
  try {
    const cache = JSON.parse(await fs.readFile(path.join(codexHome, "models_cache.json"), "utf8"));
    const seen = new Set();
    const models = (Array.isArray(cache.models) ? cache.models : [])
      .filter((model) => {
        if (model?.visibility !== "list" || typeof model.slug !== "string" || !model.slug.trim() || seen.has(model.slug)) {
          return false;
        }
        seen.add(model.slug);
        return true;
      })
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
      .map((model) => ({ id: model.slug, label: model.display_name || model.slug }));
    if (models.length) {
      return models;
    }
  } catch {
    // Without a catalog, use the CLI default rather than inventing model availability.
  }
  return [];
}
