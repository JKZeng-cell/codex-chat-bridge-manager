function unwrapMessage(value) {
  for (let depth = 0; depth < 5; depth++) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { return value.trim(); }
    } else if (value && typeof value === "object") {
      value = value.error?.message ?? value.message ?? value.error;
    } else {
      return "";
    }
  }
  return typeof value === "string" ? value.trim() : "";
}

export function getCodexFailureMessage(details = {}) {
  // Terminal turn errors explain failure; MCP startup warnings often do not.
  const events = String(details.stdoutTail || "").split(/\r?\n/).reverse();
  for (const type of ["turn.failed", "error"]) {
    for (const line of events) {
      try {
        const event = JSON.parse(line);
        if (event.type !== type) continue;
        const message = unwrapMessage(event.error ?? event.message);
        if (message) return message;
      } catch {
        // Partial JSON and non-event output remain available in the transcript.
      }
    }
  }
  return "";
}
