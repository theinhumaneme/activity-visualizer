import { useEffect, useMemo, useRef, useState } from "react";
import type { Analysis } from "../lib/analysis/types";
import { placePhotos } from "../lib/photos";
import { useStore } from "../state/store";
import { ControlRow, Segmented } from "./ui";

/** A photo's thumbnail, drawn from its decoded bitmap. */
function PhotoThumb({ bitmap, title }: { bitmap: ImageBitmap; title: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const k = Math.max(c.width / bitmap.width, c.height / bitmap.height);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bitmap, (c.width - bitmap.width * k) / 2, (c.height - bitmap.height * k) / 2, bitmap.width * k, bitmap.height * k);
  }, [bitmap]);
  return <canvas ref={ref} width={80} height={80} title={title} className="h-10 w-10 rounded-md border border-grid object-cover" />;
}

/**
 * Add, show or remove the activity's photos (Flyover and Export share them): each one pauses the
 * flyover where it was taken. Activities without times can't place photos, so nothing shows.
 */
export function PhotoPicker({ a }: { a: Analysis }) {
  const photos = useStore((s) => s.photos);
  const photosOn = useStore((s) => s.photosOn);
  const setPhotosOn = useStore((s) => s.setPhotosOn);
  const addPhotos = useStore((s) => s.addPhotos);
  const removePhoto = useStore((s) => s.removePhoto);
  const [problems, setProblems] = useState<string[]>([]);
  const placement = useMemo(() => placePhotos(a, photos), [a, photos]);
  if (a.activity.routeOnly) return null;

  return (
    <ControlRow
      label="Photos"
      hint={
        photos.length
          ? [
              `${placement.placed.length} of ${photos.length} placed on the route by ${placement.placed.every((p) => p.how === "time") ? "time" : placement.placed.some((p) => p.how === "time") ? "location or time" : "location"}; the video pauses on each.`,
              placement.unplaced.length ? ` Not near the route or taken at another time: ${placement.unplaced.map((p) => p.name).join(", ")}.` : "",
              problems.length ? ` Couldn't open ${problems.join(", ")} (this browser can't read that format).` : "",
            ].join("")
          : "The flyover pauses where you took each photo and lets it fill the screen; photos taken together become a collage. Placed by location or time, and kept on this device."
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn btn-secondary btn-sm cursor-pointer">
          Add photos
          <input
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="sr-only"
            onChange={async (e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) setProblems(await addPhotos(files));
            }}
          />
        </label>
        {photos.length > 0 && (
          <Segmented
            size="sm"
            label="Show photos"
            value={photosOn ? "on" : "off"}
            onChange={(v) => setPhotosOn(v === "on")}
            options={[
              { value: "on", label: "Show" },
              { value: "off", label: "Off" },
            ]}
          />
        )}
        {photos.map((p) => (
          <span key={p.id} className="relative inline-block">
            <PhotoThumb bitmap={p.bitmap} title={p.name} />
            <button
              type="button"
              aria-label={`Remove ${p.name}`}
              onClick={() => removePhoto(p.id)}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] leading-none text-page"
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </ControlRow>
  );
}
