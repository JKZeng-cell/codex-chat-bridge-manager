import { awaitFileOperations, queueFileOperation, readJsonFile, writeJsonFile } from "./fileStore.js";

export function buildSessionKey({ chatId, chatType }) {
  return `${chatType}:${chatId}`;
}

export function createThreadStore(filePath) {
  async function loadRecords() {
    const parsed = await readJsonFile(filePath, {});
    if (!parsed || typeof parsed !== "object") {
      return new Map();
    }

    return new Map(Object.entries(parsed));
  }

  async function persistRecords(records) {
    await writeJsonFile(filePath, Object.fromEntries(records));
  }

  return {
    async get(sessionKey) {
      await awaitFileOperations(filePath);
      const records = await loadRecords();
      return records.get(sessionKey) || null;
    },

    async list() {
      await awaitFileOperations(filePath);
      const records = await loadRecords();
      return Array.from(records.values()).sort((left, right) =>
        (right?.updatedAt || "").localeCompare(left?.updatedAt || "")
      );
    },

    async set(sessionKey, record) {
      return queueFileOperation(filePath, async () => {
        const records = await loadRecords();
        records.set(sessionKey, record);
        await persistRecords(records);
        return record;
      });
    },

    async delete(sessionKey) {
      return queueFileOperation(filePath, async () => {
        const records = await loadRecords();
        records.delete(sessionKey);
        await persistRecords(records);
      });
    },

    async update(sessionKey, updater) {
      return queueFileOperation(filePath, async () => {
        const records = await loadRecords();
        const current = records.get(sessionKey) || null;
        const next = await updater(current);

        if (next == null) {
          records.delete(sessionKey);
        } else {
          records.set(sessionKey, next);
        }

        await persistRecords(records);
        return next;
      });
    }
  };
}
