import { readFileSync } from "node:fs";
import { type Download, type Page, expect, test } from "@playwright/test";

const SAMPLE = readFileSync("public/samples/reservoir-loop.tcx.xml");

/** Fails the test on any uncaught error in the page. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function bytesOf(download: Download): Promise<Buffer> {
  return readFileSync(await download.path());
}

/** Opens the sample and waits for the flyover's map to draw. */
async function openSample(page: Page) {
  await page.goto("/?sample");
  await expect(page).toHaveURL(/\/flyover/);
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
}

/** Goes to Export the way a person would, keeping the loaded activity. */
async function goToExport(page: Page) {
  await page
    .getByRole("navigation", { name: "Steps" })
    .getByRole("link", { name: /Export$/ })
    .click();
  await expect(page).toHaveURL(/\/export/);
}

const choose = (page: Page, group: string, option: string) =>
  page.getByRole("group", { name: group }).getByRole("button", { name: option, exact: true }).click();

test("the sample opens straight into the flyover", async ({ page }) => {
  const errors = watchErrors(page);
  await openSample(page);
  // The map has drawn something, not just a blank canvas.
  const size = await page.locator("canvas.maplibregl-canvas").evaluate((c: HTMLCanvasElement) => c.width * c.height);
  expect(size).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("a poster renders and downloads as a PNG", async ({ page }) => {
  const errors = watchErrors(page);
  await openSample(page);
  await goToExport(page);
  await choose(page, "Output", "Poster (PNG)");
  await page.getByRole("button", { name: /^Render poster/ }).click();
  await expect(page.getByRole("heading", { name: "Your poster is ready" })).toBeVisible({ timeout: 120_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Download poster/ }).click()]);
  const png = await bytesOf(download);
  expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
  expect(png.length).toBeGreaterThan(50_000);
  expect(errors).toEqual([]);
});

test.describe("video", () => {
  // No globe dive with reduced motion: a shorter, quicker clip.
  test.use({ reducedMotion: "reduce" });

  test("a short 720p clip renders and downloads as an MP4", async ({ page }) => {
    test.setTimeout(600_000);
    const errors = watchErrors(page);
    await openSample(page);
    await goToExport(page);
    await choose(page, "Output", "Video");
    await choose(page, "Quality", "720p");
    await choose(page, "Route playback length", "15 s");
    await page.getByRole("button", { name: /^Render video/ }).click();
    await expect(page.getByRole("heading", { name: "Your video is ready" })).toBeVisible({ timeout: 540_000 });
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Download video/ }).click()]);
    const video = await bytesOf(download);
    // MP4 (or the WebM fallback where the browser has no H.264 encoder), and not an empty one.
    const mp4 = video.subarray(4, 8).toString("latin1") === "ftyp";
    const webm = video.readUInt32BE(0) === 0x1a45dfa3;
    expect(mp4 || webm).toBe(true);
    expect(video.length).toBeGreaterThan(100_000);
    expect(errors).toEqual([]);
  });
});

test("the library backs up and restores, Strava names included", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/library");
  const csv =
    "Activity ID,Activity Date,Activity Name,Activity Type,Activity Description,Filename,Activity Gear\n1,,Sunday reservoir tempo,Run,,activities/reservoir-loop.tcx,Pegasus 41\n";
  await page
    .locator('input[type="file"][multiple][accept]')
    .first()
    .setInputFiles([
      { name: "reservoir-loop.tcx", mimeType: "application/xml", buffer: SAMPLE },
      { name: "activities.csv", mimeType: "text/csv", buffer: Buffer.from(csv) },
    ]);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^1 run\./);
  // Names are in the activity list (the tab is remembered from here on).
  await page.getByRole("navigation", { name: "Library views" }).getByRole("button", { name: "Activities" }).click();
  await expect(page.getByText("Sunday reservoir tempo").first()).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Back up" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^activity-library-\d{4}-\d{2}-\d{2}\.zip$/);
  const zip = await bytesOf(download);
  expect(zip.subarray(0, 2).toString("latin1")).toBe("PK");

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(heading).toHaveText("Your library");

  // Restore from the backup alone: the Strava name comes back with it.
  await page
    .locator('input[type="file"][multiple][accept]')
    .first()
    .setInputFiles({ name: download.suggestedFilename(), mimeType: "application/zip", buffer: zip });
  await expect(heading).toHaveText(/^1 run\./);
  await expect(page.getByText("Sunday reservoir tempo").first()).toBeVisible();

  // And it's still there after a reload (kept in IndexedDB).
  await page.reload();
  await expect(heading).toHaveText(/^1 run\./);
  expect(errors).toEqual([]);
});
