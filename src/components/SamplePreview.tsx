// A still of what the flyover produces, for the upload page: the sample run's real loop
// (Central Park Reservoir, from public/samples) tilted like the 3D camera, with the live HUD.

/** The sample route projected to a 400×300 box, starting at its start and running the same way. */
const ROUTE =
  "M261 208L272 187L277 179L284 167L296 144L302 133L308 123L310 120L311 117L311 115L312 113L312 111L313 109L313 107L312 104L312 98L312 84L313 80L313 77L314 73L315 68L317 62L318 59L319 56L319 54L320 52L320 49L320 46L320 45L320 43L319 41L317 38L316 37L315 35L314 34L311 32L309 31L307 31L305 30L301 30L299 30L297 31L296 31L295 32L292 33L288 35L285 37L283 37L281 38L277 39L273 41L271 41L268 41L265 41L261 41L258 41L255 40L253 40L251 39L248 38L245 37L241 35L234 32L230 31L229 31L226 31L220 31L215 33L211 35L208 37L206 39L204 41L202 44L200 47L198 48L196 50L194 51L192 52L189 53L187 53L185 54L182 54L180 54L178 53L177 53L175 53L172 53L170 53L169 53L166 53L163 54L159 54L156 55L153 55L150 55L147 55L144 54L141 54L138 53L135 52L132 52L129 52L127 53L124 53L121 54L119 54L117 56L114 57L110 59L107 61L103 65L99 69L97 73L95 76L93 80L92 85L91 94L89 104L85 124L82 140L80 155L80 158L80 160L80 163L82 166L83 168L87 173L96 181L111 191L115 193L122 196L124 197L128 198L132 199L138 202L142 204L149 207L152 210L155 212L159 216L161 219L164 222L166 226L168 230L170 234L172 239L172 242L173 246L174 249L175 252L176 254L179 257L181 259L184 261L188 264L194 267L196 268L198 269L201 269L203 270L206 270L208 270L210 270L213 270L216 269L218 268L221 267L225 265L227 264L229 262L232 259L234 256L235 255L241 244L248 232L261 208";
const START = [261, 208];
/** Where the runner is in this frame: 68% of the way round. */
const HEAD = [87.1, 172.7];
const PROGRESS = 68;

/** Loose terrain contours around the loop. */
const CONTOURS = Array.from({ length: 9 }, (_, k) => {
  const r = 70 + k * 26;
  const pts = Array.from({ length: 48 }, (_, i) => {
    const t = (i / 48) * Math.PI * 2;
    const wob = 1 + 0.07 * Math.sin(3 * t + k) + 0.05 * Math.cos(5 * t - k * 0.7);
    return `${(200 + Math.cos(t) * r * 1.25 * wob).toFixed(1)} ${(150 + Math.sin(t) * r * wob).toFixed(1)}`;
  });
  return `M${pts.join("L")}Z`;
});

export function SamplePreview({ className = "" }: { className?: string }) {
  return (
    <figure
      className={`relative isolate overflow-hidden rounded-[20px] bg-[#0b0f12] text-white shadow-[var(--shadow-pop)] ring-1 ring-grid ${className}`}
      aria-label="Preview: a 3D flyover of the sample run, with live distance, pace and heart rate"
    >
      {/* The ground, tilted like the flyover camera. */}
      <div className="absolute inset-0 [perspective:900px]" aria-hidden>
        <svg
          viewBox="0 0 400 300"
          className="absolute left-[6%] top-[-4%] h-[88%] w-[88%] origin-center [transform:rotateX(42deg)_rotateZ(-14deg)]"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <radialGradient id="sp-ground" cx="50%" cy="55%" r="70%">
              <stop offset="0" stopColor="#1b2a26" />
              <stop offset="0.55" stopColor="#121b1c" />
              <stop offset="1" stopColor="#0b0f12" />
            </radialGradient>
            <filter id="sp-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
          </defs>
          <rect x="-200" y="-200" width="800" height="700" fill="url(#sp-ground)" />
          {/* Water inside the loop. */}
          <path d={ROUTE} fill="#16304a" fillOpacity="0.55" />
          {CONTOURS.map((d, k) => (
            <path key={k} d={d} fill="none" stroke="#ffffff" strokeOpacity={k % 3 === 0 ? 0.09 : 0.045} strokeWidth="0.8" />
          ))}
          {/* Route ahead (ghost), the glow and the run so far. */}
          <path d={ROUTE} fill="none" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="2.5" strokeLinejoin="round" />
          <path
            d={ROUTE}
            pathLength={100}
            strokeDasharray={`${PROGRESS} 100`}
            fill="none"
            stroke="#ff5a1f"
            strokeOpacity="0.55"
            strokeWidth="11"
            filter="url(#sp-glow)"
          />
          <path
            d={ROUTE}
            pathLength={100}
            strokeDasharray={`${PROGRESS} 100`}
            fill="none"
            stroke="#07080a"
            strokeOpacity="0.6"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={ROUTE}
            pathLength={100}
            strokeDasharray={`${PROGRESS} 100`}
            fill="none"
            stroke="#ff5a1f"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={START[0]} cy={START[1]} r="6" fill="#57c785" stroke="#fff" strokeWidth="2.5" />
          <circle cx={HEAD[0]} cy={HEAD[1]} r="14" fill="#ff5a1f" fillOpacity="0.25" />
          <circle cx={HEAD[0]} cy={HEAD[1]} r="7" fill="#ff5a1f" stroke="#fff" strokeWidth="2.5" />
        </svg>
        {/* Sky haze at the horizon. */}
        <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-[#0b0f12] via-[#0b0f12]/70 to-transparent" />
      </div>

      {/* HUD, as drawn over the flyover and in exported videos. */}
      <figcaption className="relative flex h-full flex-col justify-between p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[clamp(1.25rem,3.4vw,1.75rem)] font-extrabold uppercase leading-none tracking-[-0.02em] [text-shadow:0_2px_12px_rgba(0,0,0,0.6)]">
              Reservoir Loop
            </p>
            <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/70">Sample run · 3D flyover</p>
          </div>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] text-white/80 backdrop-blur">TIME ×60</span>
        </div>
        <div className="glass grid grid-cols-3 gap-2 rounded-2xl px-3.5 py-3 ring-1 ring-white/10 sm:px-4">
          {(
            [
              ["Distance", "1.74", "km"],
              ["Pace", "6:58", "/km"],
              ["Heart rate", "168", "bpm"],
            ] as const
          ).map(([label, value, unit]) => (
            <div key={label} className="min-w-0">
              <div className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-white/60">{label}</div>
              <div className="num mt-0.5 text-[clamp(1.25rem,3vw,1.625rem)] leading-none !text-white">
                {value}
                <span className="unit !text-white/60">{unit}</span>
              </div>
            </div>
          ))}
          <div className="col-span-3 mt-1 h-1 overflow-hidden rounded-full bg-white/15" aria-hidden>
            <div className="h-full rounded-full bg-[#ff5a1f]" style={{ width: `${PROGRESS}%` }} />
          </div>
        </div>
      </figcaption>
    </figure>
  );
}
