# Activity Visualizer for Windows (portable)

A single `ActivityVisualizer-portable.exe`, with no install, Node or npm. It wraps the web app from
[theinhumaneme/activity-visualizer](https://github.com/theinhumaneme/activity-visualizer) in Electron.

- **Download:** the [Releases](https://github.com/ThePlayse/activity-visualizer/releases) page. Each
  release is built automatically from the latest commit of the original repo, checked daily by
  `.github/workflows/desktop.yml`. You can also run it by hand from the Actions tab.
- **Updates:** at startup the exe checks for a newer release and offers to download it.
- **Data:** the library and settings are stored in `ActivityVisualizer-data`, next to the exe. Keep
  that folder when you replace the exe.
- **Internet:** map tiles, terrain and weather come from online providers, as in the web version.

## Build locally

You need Node 24 and git:

```powershell
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
```

This clones (or updates) the original repo in `desktop/.upstream` and builds it. The result is
`desktop/release/ActivityVisualizer-portable.exe`.

`desktop/` is the only folder this fork adds (plus the workflow), so syncing the fork with the
original never conflicts.
