# Git & Conquer: Total Refactor!

**Git & Conquer** is a gamified, interactive visualization of your Git repository history based on surviving **Git Blame** lines of code (LOC) over time. Watch contributors claim territory, refactor away bloated modules, and compete across Total Empire, Monthly, and Quarterly rounds.

---

## Features

- **Surviving-Code Territory Map:** Every block on the island grid represents surviving lines of code standing in your repository at that point in history.
- **Three Score Modes:**
  - **Total Empire:** Cumulative surviving lines of code across the repository's history.
  - **Monthly Conquered:** Month-by-month rounds with champion banners and trailing 3-month growth baselines.
  - **Quarterly Conquered:** Quarter-by-quarter rounds and growth comparisons.
- **Contributor Customization & Identity Merging:** Customize contributor display names, colors, initials, and avatars, or merge multiple Git author aliases in **Settings**.
- **Responsive & Mobile-Friendly:** Desktop/tablet sidebar and collapsible mobile bottom-sheet leaderboard with touch pan, pinch-to-zoom, and double-tap camera follow.
- **100% Local Processing:** Your source code never leaves your machine. The analyzer script extracts only commit dates, author names, and surviving line counts into a JSON file that you load in the browser.

---

## Quick Start

### 1. Generate Battle Data from Your Git Repo(s)

Run the standalone shell script against one or more local Git repositories:

```bash
bash generate-cnc-data.sh -p 16 -o ./cnc_data.json /path/to/your/repo
```

Or run it directly with a one-liner:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Vylor-AI/commit-and-conquer/refs/heads/master/generate-cnc-data.sh) -p 16 -o ./cnc_data.json /path/to/your/repo
```

*(Alternatively, you can run the Node.js analyzer CLI in `tools/cc_analyze/index.js`: `node tools/cc_analyze/index.js --output ./cnc_data.json /path/to/your/repo`.)*

### 2. Run the Web App Locally

The web app in `public/` is a static site with zero build step required.

```bash
# Copy the example runtime config
cp public/config.example.js public/config.js

# Serve the public/ directory with any static file server
npx serve public
```

Open the local URL in your browser and drag-and-drop your generated `cnc_data.json` file into the import prompt.

---

## Runtime Configuration (`public/config.js`)

Copy `public/config.example.js` to `public/config.js` to customize optional settings:

| Variable | Description |
| :--- | :--- |
| `window.AMPLITUDE_API_KEY` | Optional Amplitude Browser SDK API key. When empty (default), analytics runs in silent/no-op mode. |
| `window.CNC_API_BASE_URL` | Optional backend URL for generating shareable links (`#/s/<id>`). When unset on localhost or custom domains, the Share button is hidden. |
| `window.CNC_DEFAULT_REPO` | Default repository key when a snapshot omits `repo` (default: `"main"`). |
| `window.CNC_PRIORITY_PLAYERS` | Optional array of contributor names to place near island centers. |

---

## Project Structure

```text
.
├── public/                 # Static web application (HTML, CSS, Canvas renderer)
│   ├── index.html          # Main application entry point
│   ├── mapper.js           # Data-preparation & period contribution models
│   ├── config.example.js   # Example runtime configuration
│   ├── styles/main.css     # Responsive desktop, tablet, and mobile styles
│   └── scripts/            # Simulation, rendering, controls, settings, and import UI
├── tools/cc_analyze/       # Node.js Git blame history analyzer CLI
├── generate-cnc-data.sh    # Fast parallel shell/awk Git blame history generator
└── ci/deploy.sh            # S3 + CloudFront deployment script
```

---

## License

The source code in this repository is licensed under the [MIT License](./LICENSE).

> **Note on Brand Assets:** The Git & Conquer / Vylor logos and brand marks under `public/brand/` and `public/logo-*.svg` are copyright Vylor AI and are not licensed for trademark reuse without permission.

