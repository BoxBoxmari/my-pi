import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestLimiter } from "@my-pi/mcp-adapter";

test("request limiter bounds concurrent work and aborts queued requests", async () => {
  const limiter = new RequestLimiter(1);
  const releaseFirst = await limiter.acquire(new AbortController().signal);
  const queuedAbort = new AbortController();
  const queued = limiter.acquire(queuedAbort.signal);
  queuedAbort.abort();
  await assert.rejects(queued, (error: unknown) => (error as { code?: string }).code === "ERR_ABORTED");

  releaseFirst();
  const releaseThird = await limiter.acquire(new AbortController().signal);
  releaseThird();
});

test("request limiter transfers a released slot to the next waiter", async () => {
  const limiter = new RequestLimiter(1);
  const releaseFirst = await limiter.acquire(new AbortController().signal);
  let secondStarted = false;
  const second = limiter.acquire(new AbortController().signal).then((release) => {
    secondStarted = true;
    return release;
  });
  await Promise.resolve();
  assert.equal(secondStarted, false);
  releaseFirst();
  const releaseSecond = await second;
  assert.equal(secondStarted, true);
  releaseSecond();
});

test("request limiter rejects work beyond its bounded queue", async () => {
  const limiter = new RequestLimiter(1, 0);
  const release = await limiter.acquire(new AbortController().signal);
  await assert.rejects(
    limiter.acquire(new AbortController().signal),
    (error: unknown) => (error as { code?: string }).code === "ERR_OUTPUT_LIMIT",
  );
  release();
});
