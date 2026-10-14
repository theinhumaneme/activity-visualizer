// fetch() with retries for tile requests: rate limits (429, honoring Retry-After), server errors
// and network errors back off and try again. No MapLibre import, so the upload page (which
// samples terrain) stays small.

/** Running counts, read by the exporter to tell whether a frame is complete. */
export const tileHealth = {
  /** Tiles that still failed after every retry (404 "no tile here" doesn't count). */
  failed: 0,
  /** Retries made, and how many were for rate limiting. */
  retried: 0,
  rateLimited: 0,
  /** URLs of failed tiles since the last reload, to find which sources to reload. */
  failedUrls: new Set<string>(),
};

/** Statuses that mean "there is no such tile" or "you may not": retrying won't change them. */
const FINAL = new Set([400, 401, 403, 404, 410]);
const MAX_ATTEMPTS = 6;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

/** Exponential backoff with jitter (0.4 s, 0.8 s, 1.6 s … capped at 8 s). */
const backoff = (attempt: number) => Math.min(8000, 400 * 2 ** attempt) * (0.75 + Math.random() * 0.5);

/**
 * fetch() that retries rate limits (429, honoring Retry-After), server errors and network errors.
 * Returns the last response (possibly not ok) once retries run out or the status is final.
 */
export async function fetchWithRetry(url: string, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, { signal });
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) throw err;
      if (attempt + 1 >= MAX_ATTEMPTS) throw err;
    }
    if (res && (res.ok || FINAL.has(res.status) || attempt + 1 >= MAX_ATTEMPTS)) return res;
    let wait = backoff(attempt);
    if (res?.status === 429) {
      tileHealth.rateLimited++;
      const after = Number(res.headers.get("Retry-After"));
      if (Number.isFinite(after) && after > 0) wait = Math.min(30_000, after * 1000);
    }
    tileHealth.retried++;
    await sleep(wait, signal);
  }
}
