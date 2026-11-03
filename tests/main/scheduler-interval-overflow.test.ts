import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler, MAX_INTERVAL_MS } from '../../src/main/scheduler/Scheduler.ts';

// Verify that intervals exceeding Node's timer limit are split into safe chunks
// and do not degenerate into a rapid (1 ms) timer.
test('large interval is chunked and does not fire excessively', async () => {
  const scheduler = new Scheduler();
  let runs = 0;
  // Choose a period slightly larger than the max safe timeout (≈25 days).
  const oversize = MAX_INTERVAL_MS + 1_000; // add a second
  scheduler.register({ name: 'big', intervalMs: oversize, run: () => runs++ });
  scheduler.start();

  // Wait a short real‑world time; the task should not fire many times.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  scheduler.stop();

  // The timer may have fired at most once (the first chunk could have elapsed).
  // It must never have fired dozens of times as would happen if the interval
  // overflowed to 1 ms.
  assert.ok(runs <= 2, `expected at most 2 executions for oversized interval, got ${runs}`);
});
