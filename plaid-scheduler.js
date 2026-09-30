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

  function schedule(delay) {
    if (stopped || running) return;
    timer = setTimeoutFn(run, delay);
  }

  async function run() {
    if (stopped || running) return;
    timer = null;
    running = true;
    try {
      const outcomes = await syncService.syncAllHealthy();
      consecutiveFailures = 0;
      for (const outcome of outcomes || []) {
        if (!outcome.ok) logger.error('Plaid connection sync failed', { connectionId: outcome.connectionId, code: outcome.code });
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
