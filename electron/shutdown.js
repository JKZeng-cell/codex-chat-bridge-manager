function withTimeout(action, milliseconds) {
  let timer;
  return Promise.race([
    Promise.resolve().then(action),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Desktop shutdown timed out")), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

export function createShutdownCoordinator({ inspect, stop, exit, onBlocked, onInspectionError, onStopError, timeoutMs = 10000 }) {
  let pending;
  return {
    request() {
      if (pending) return pending;
      pending = (async () => {
        let status;
        try { status = await withTimeout(inspect, timeoutMs); }
        catch (error) { await onInspectionError(error); return; }
        if (status.busy) { await onBlocked(); return; }
        try { await withTimeout(stop, timeoutMs); }
        catch (error) { onStopError(error); exit(1); return; }
        exit(0);
      })().finally(() => { pending = null; });
      return pending;
    }
  };
}
