import { useRef, useState } from "react";
import { droppedFiles } from "../../lib/library/files";
import { useLibrary } from "../../state/library";

const ACCEPT = ".fit,.tcx,.gpx,.gz,application/xml,text/xml,application/gzip";

/** "Add files" / "Add a folder" buttons, optionally inside a drop zone. */
export function AddFiles({ zone = false }: { zone?: boolean }) {
  const addFiles = useLibrary((s) => s.addFiles);
  const loading = useLibrary((s) => s.loading);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = (list: FileList | null) => {
    if (list?.length) void addFiles(Array.from(list));
  };

  const buttons = (
    <div className="flex flex-wrap justify-center gap-2">
      <button
        onClick={() => files.current?.click()}
        disabled={loading}
        className={`btn ${zone ? "btn-primary" : "btn-secondary btn-sm"}`}
      >
        {zone ? "Choose files" : "Add files"}
      </button>
      <button onClick={() => folder.current?.click()} disabled={loading} className={`btn btn-secondary ${zone ? "" : "btn-sm"}`}>
        {zone ? "Choose a folder" : "Add a folder"}
      </button>
      <input
        ref={files}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={folder}
        type="file"
        multiple
        className="hidden"
        {...{ webkitdirectory: "" }}
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );

  if (!zone) return buttons;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const pending = droppedFiles(e.dataTransfer);
        void pending.then((list) => {
          if (list.length) void addFiles(list);
        });
      }}
      className={`flex flex-col items-center rounded-3xl border-2 border-dashed px-6 py-12 text-center transition-colors ${dragging ? "border-accent bg-accent/10" : "border-line bg-surface"}`}
    >
      <p className="font-display text-3xl font-semibold uppercase">Drop everything you've recorded.</p>
      <p className="mt-2 max-w-md text-sm text-ink-2">
        Runs, rides, hikes, swims: a stack of .fit, .tcx or .gpx files, or a whole folder. A Strava bulk export's <em>activities</em> folder works, .gz and all. Everything stays on this device.
      </p>
      <div className="mt-5">{buttons}</div>
    </div>
  );
}
