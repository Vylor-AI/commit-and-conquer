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

## Pull Requests

- Create a feature branch from `master` (or `develop`).
- Keep pull requests focused and include a short summary of the change and before/after screenshots for UI updates.

