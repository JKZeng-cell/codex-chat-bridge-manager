import fsp from "node:fs/promises";
import path from "node:path";

const fileOperationChains = new Map();

function resolveFallback(fallbackValue) {
  return typeof fallbackValue === "function" ? fallbackValue() : fallbackValue;
}

export async function readJsonFile(filePath, fallbackValue = null) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return resolveFallback(fallbackValue);
    }

    throw error;
  }
}

export async function writeJsonFile(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function queueFileOperation(filePath, operation) {
  const previous = fileOperationChains.get(filePath) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);

  fileOperationChains.set(filePath, current);

  return current.finally(() => {
    if (fileOperationChains.get(filePath) === current) {
      fileOperationChains.delete(filePath);
    }
  });
}

export async function awaitFileOperations(filePath) {
  const current = fileOperationChains.get(filePath);
  if (current) {
    await current.catch(() => {});
  }
}

export async function updateJsonFile(filePath, updater, fallbackValue = null) {
  return queueFileOperation(filePath, async () => {
    const current = await readJsonFile(filePath, fallbackValue);
    const next = await updater(current);
    await writeJsonFile(filePath, next);
    return next;
  });
}
