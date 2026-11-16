# Contributing to Git & Conquer

Thank you for your interest in contributing to **Git & Conquer**!

## Development Workflow

1. **Fork & Clone** the repository.
2. Copy the example config:
   ```bash
   cp public/config.example.js public/config.js
   ```
3. Serve `public/` locally using any static server (e.g., `npx serve public` or `python -m http.server -d public 8080`).
4. Generate a sample dataset using `./generate-cnc-data.sh -o ./sample.json .` and import it into the UI to test your changes.

## Guidelines

- **Zero Build Dependencies in `public/`:** Keep `public/` runnable as plain static HTML/CSS/JS without requiring a bundler.
- **Performance:** Test playback at **Hyper Blitz** (`?debug=1` in the URL displays an FPS, world-cache, and active-effects counter) to verify smooth frame times.
- **Responsive Design:** Verify UI changes across desktop (`1440×900`), tablet (`768×1024`), and mobile (`390×844`) viewports.
- **No Sensitive Data:** Never commit `public/config.js`, real API keys, or personal/private repository datasets.

## Adding a Repository to the Showcase

1. Add `{ "repo": "owner/name" }` to [`showcase/repos.json`](./showcase/repos.json) (optional fields: `ref`, `since`, `maxAuthors`, `maxSteps`, `description`).
2. Test locally (note `public/demos/` is git-ignored):
   ```bash
   node tools/showcase/analyze-one.js --repo owner/name --out-dir ./demos-tmp
   node tools/showcase/build-index.js --config showcase/repos.json --artifacts-dir ./demos-tmp --out-dir public/demos
   ```
3. Run the unit tests:
   ```bash
   node --test tools/cc_analyze/test/compactExporter.test.js tools/showcase/test/showcase.test.js
   ```
4. Once merged, trigger **Refresh Showcase Demos** via `workflow_dispatch` (you can pass `repo: owner/name` to refresh only the new repository).

## Pull Requests

- Create a feature branch from `master` (or `develop`).
- Keep pull requests focused and include a short summary of the change and before/after screenshots for UI updates.

