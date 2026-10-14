import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry, tileHealth } from "./retryFetch";

const reply = (status: number, headers: Record<string, string> = {}) => new Response(status === 200 ? "tile" : null, { status, headers });

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tileHealth.retried = tileHealth.rateLimited = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const run = async (responses: (Response | Error)[]) => {
    const fetch = vi.fn(async () => {
      const r = responses.shift()!;
      if (r instanceof Error) throw r;
      return r;
    });
    vi.stubGlobal("fetch", fetch);
    const p = fetchWithRetry("https://example.test/tile");
    await vi.runAllTimersAsync();
    return { res: await p, calls: fetch.mock.calls.length };
  };

  it("waits out a rate limit, honoring Retry-After", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply(429, { "Retry-After": "3" })).mockResolvedValueOnce(reply(200));
    vi.stubGlobal("fetch", fetch);
    const p = fetchWithRetry("https://example.test/tile");
    await vi.advanceTimersByTimeAsync(2900);
    expect(fetch).toHaveBeenCalledTimes(1); // still waiting the 3 s it was told to
    await vi.advanceTimersByTimeAsync(200);
    expect((await p).status).toBe(200);
    expect(tileHealth.rateLimited).toBe(1);
  });

  it("retries server and network errors, then succeeds", async () => {
    const { res, calls } = await run([reply(503), new TypeError("Failed to fetch"), reply(200)]);
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
    expect(tileHealth.retried).toBe(2);
  });

  it("doesn't retry a tile that doesn't exist", async () => {
    const { res, calls } = await run([reply(404)]);
    expect(res.status).toBe(404);
    expect(calls).toBe(1);
  });

  it("gives up after a bounded number of attempts", async () => {
    const { res, calls } = await run(Array.from({ length: 10 }, () => reply(502)));
    expect(res.status).toBe(502);
    expect(calls).toBe(6);
  });
});
