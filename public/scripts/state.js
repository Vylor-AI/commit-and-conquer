const canvas = document.getElementById("battleCanvas");
const ctx = canvas.getContext("2d");
const zoomHud = document.getElementById("zoom-hud");
const playBtn = document.getElementById("play-pause-btn");
const slider = document.getElementById("timeline-slider");
const speedSelect = document.getElementById("speed-select");
const counter = document.getElementById("timeline-counter");
const modeTotalBtn = document.getElementById("mode-total-btn");
const modeMonthlyBtn = document.getElementById("mode-monthly-btn");
const modeQuarterlyBtn = document.getElementById("mode-quarterly-btn");

// --- VIEWPORT & RESPONSIVE LAYOUT CONFIG ---
let viewWidth = window.innerWidth;
let viewHeight = window.innerHeight;
let canvasDpr = Math.min(window.devicePixelRatio || 1, 2);

function getSidebarWidth(w = viewWidth) {
  if (w <= 640) return 0;
  if (w <= 1024) return 270;
  return Math.round(Math.min(400, Math.max(300, w * 0.28)));
}

let SB_WIDTH = getSidebarWidth(viewWidth);
const CELL = 18;
const BLOCK = 15;
const VIEW_PAD = 0.86;

const PALETTE = {
  water: "#0a1626",
  waterGrid: "#122238",
  sand: "#e7cf9a",
  sandEdge: "#cbae6f",
  sidebarBg: "#0f1420",
  border: "#232b3d",
  textMain: "#eaf1fb",
  textDim: "#8a97ad",
};

const RANKS = [
  { name: "Code Cadet", icon: "◦" },
  { name: "Tech Sergeant", icon: "▴" },
  { name: "Systems Captain", icon: "★" },
  { name: "Base Commander", icon: "★★" },
  { name: "Matrix Warlord", icon: "✦" },
];

const REPO_ISLANDS = Array.isArray(window.CNC_REPO_ISLANDS)
  ? window.CNC_REPO_ISLANDS
  : [
      {
        match: (n) => !String(n || "").includes("web"),
        label: "THE FORTRESS · backend",
        short: "Fortress",
      },
      {
        match: (n) => String(n || "").includes("web"),
        label: "THE FRONTLINE · frontend",
        short: "Frontline",
      },
    ];
const ISLAND_GAP = 9;

// --- ZOOM = LINES PER BLOCK ---
let linesPerBlock = 100;
const LPB_MIN = 10;
const LPB_MAX = 800;

// --- CAMERA ---
let cellPx = CELL;
let baseOffsetX = SB_WIDTH;
let baseOffsetY = 0;
let mapOffsetX = SB_WIDTH;
let mapOffsetY = 0;
let pan = { x: 0, y: 0 };
let followCam = true;

let isDragging = false;
let dragStart = { x: 0, y: 0 };

// --- SIMULATION DATA ---
let historyTimeline = [];
let monthlyRepoScoresTimeline = [];
let monthlyContributionModel = null;
let quarterlyContributionModel = null;

let currentFrameIndex = 0;
let isPlaying = true;
let lastFrameTime = performance.now();
let frameAccumulator = 0;
let scoreMode = "total";

const ROUND_PAUSE_MS = 4000;
let roundPauseUntil = 0;
let roundBanner = null;

let liveProjectiles = [];
let impactBlasts = [];
let floatingTexts = [];
let playerRankY = {};
let screenShake = 0;
let lastCentroids = [];

let gameEvents = [];
let afkByPlayer = {};

const avatarImages = {};
let profileRevision = 0;

function resolveProfileAvatarSource(name, profile) {
  const avatar =
    typeof profile.avatar === "string" ? profile.avatar.trim() : "";
  if (!avatar) return "";

  if (
    avatar.startsWith("http://") ||
    avatar.startsWith("https://") ||
    avatar.startsWith("data:") ||
    avatar.startsWith("blob:") ||
    avatar.startsWith("/") ||
    avatar.startsWith("public/") ||
    avatar.startsWith("avatars/")
  ) {
    return avatar;
  }

  return `avatars/${avatar}`;
}

function loadAvatarImageForProfile(name, profile) {
  const source = resolveProfileAvatarSource(name, profile);
  if (!source) {
    delete avatarImages[name];
    return;
  }

  const img = new Image();
  img.onload = () => {
    avatarImages[name] = img;
    profileRevision++;
  };

  img.src = source;
}

function refreshAvatarImages() {
  Object.keys(avatarImages).forEach((name) => {
    if (!PLAYER_PROFILES[name]) {
      delete avatarImages[name];
    }
  });

  Object.entries(PLAYER_PROFILES).forEach(([name, profile]) => {
    if (!profile || typeof profile !== "object") return;
    loadAvatarImageForProfile(name, profile);
  });
  profileRevision++;
}

refreshAvatarImages();

const PRIORITY_SEATS = new Set(
  Array.isArray(window.CNC_PRIORITY_PLAYERS) ? window.CNC_PRIORITY_PLAYERS : []
);

let ISLAND_SEATS = [];

const sx = (c) => mapOffsetX + c * cellPx;
const sy = (r) => mapOffsetY + r * cellPx;

window.refreshAvatarImages = refreshAvatarImages;
