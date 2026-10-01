function createPlaidScheduler({
  syncService,
  intervalMs,
  enabled = true,
  initialDelayMs = 60_000,
  maxBackoffMs = intervalMs * 8,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  logger = console
}) {
  let timer = null;
  let running = false;
  let stopped = true;
  let consecutiveFailures = 0;
  const failureCounts = new Map();
  const cooldownCycles = new Map();

  function schedule(delay) {
    if (stopped || running) return;
    timer = setTimeoutFn(run, delay);
  }

  async function run() {
    if (stopped || running) return;
    timer = null;
    running = true;
    try {
      const excluded = [];
      for (const [connectionId, cycles] of cooldownCycles) {
        if (cycles > 0) {
          excluded.push(connectionId);
          cooldownCycles.set(connectionId, cycles - 1);
        } else cooldownCycles.delete(connectionId);
      }
      const outcomes = await syncService.syncAllHealthy({ excludeConnectionIds: excluded });
      consecutiveFailures = 0;
      for (const outcome of outcomes || []) {
        if (!outcome.ok) {
          const count = (failureCounts.get(outcome.connectionId) || 0) + 1;
          failureCounts.set(outcome.connectionId, count);
          cooldownCycles.set(outcome.connectionId, Math.min((2 ** count) - 1, 7));
          logger.error('Plaid connection sync failed', { connectionId: outcome.connectionId, code: outcome.code });
        } else {
          failureCounts.delete(outcome.connectionId);
          cooldownCycles.delete(outcome.connectionId);
        }
      }
    } catch (error) {
      consecutiveFailures++;
      logger.error('Scheduled Plaid sync failed', { code: error.code || 'SYNC_FAILED' });
    } finally {
      running = false;
      if (!stopped) {
        const delay = consecutiveFailures
          ? Math.min(intervalMs * (2 ** consecutiveFailures), maxBackoffMs)
          : intervalMs;
        schedule(delay);
      }
    }
  }

  return {
    start() {
      if (!enabled || !stopped) return;
      stopped = false;
      schedule(initialDelayMs);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeoutFn(timer);
      timer = null;
    }
  };
}

module.exports = { createPlaidScheduler };
