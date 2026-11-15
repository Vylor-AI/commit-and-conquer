let worldCache = new WeakMap();
let worldStats = {
  builds: 0,
  hits: 0,
  lastBuildMs: 0,
};

function invalidateWorldCache() {
  worldCache = new WeakMap();
}

function precomputeLayout(finalRepoScores) {
  const fallbackStep = historyTimeline[historyTimeline.length - 1] || {};
  const sourceScores = finalRepoScores || fallbackStep.repoScores || {};

  ISLAND_SEATS = REPO_ISLANDS.map((island) => {
    let totals = {};
    Object.entries(sourceScores).forEach(([repo, ps]) => {
      if (!island.match(repo)) return;
      Object.entries(ps).forEach(([n, loc]) => {
        totals[n] = (totals[n] || 0) + loc;
      });
    });
    let order = Object.keys(totals)
      .filter((n) => totals[n] > 0)
      .sort((a, b) => totals[b] - totals[a]);
    let seat = {};
    order.forEach((n, i) => (seat[n] = i));
    return { order, seat };
  });

  invalidateWorldCache();
}

// --- WORLD BUILD (MEMOIZED + O(N) BFS) ---
function buildWorld(repoScores) {
  const lpb = Math.round(linesPerBlock * 100) / 100;
  if (repoScores && typeof repoScores === "object") {
    const cached = worldCache.get(repoScores);
    if (cached && cached.lpb === lpb && cached.seatsRef === ISLAND_SEATS) {
      worldStats.hits++;
      return cached.world;
    }
  }

  const t0 = performance.now();
  const owner = new Map();
  const blocksByPlayer = new Map();
  const ownerCoordList = [];
  const key = (r, c) => r + "," + c;
  const centroids = [];

  let cursorC = 0;

  if (repoScores) {
    REPO_ISLANDS.forEach((island, islandIdx) => {
      let allocs = [];
      let totalBlocks = 0;
      Object.entries(repoScores).forEach(([repoName, pScores]) => {
        if (!island.match(repoName)) return;
        Object.entries(pScores).forEach(([player, score]) => {
          let blocks = Math.floor(score / linesPerBlock);
          if (blocks > 0) {
            allocs.push({ name: player, count: blocks });
            totalBlocks += blocks;
          }
        });
      });
      if (allocs.length === 0) return;

      const layout = ISLAND_SEATS[islandIdx] || { order: [], seat: {} };
      let seatOf = Object.assign({}, layout.seat);
      let nextSlot = layout.order.length;
      allocs.forEach((a) => {
        if (seatOf[a.name] === undefined) seatOf[a.name] = nextSlot++;
      });
      const slotCount = Math.max(nextSlot, 1);

      const ringR = 2 + Math.sqrt(slotCount) * 1.4;
      const estR = Math.ceil(Math.sqrt(totalBlocks) + ringR + 3);
      const centerC = cursorC + estR;
      const centerR = 0;

      allocs.forEach((a) => {
        let idx = seatOf[a.name];
        if (idx === 0) {
          a.seed = { r: centerR, c: centerC };
        } else {
          const ang = ((idx - 1) / Math.max(1, slotCount - 1)) * Math.PI * 2;
          a.seed = {
            r: Math.round(centerR + Math.sin(ang) * ringR),
            c: Math.round(centerC + Math.cos(ang) * ringR),
          };
        }
      });

      allocs.sort((a, b) => {
        const rank = (x) =>
          seatOf[x.name] === 0
            ? -2
            : PRIORITY_SEATS.has(x.name)
              ? -1
              : seatOf[x.name];
        return rank(a) - rank(b);
      });

      let islandMaxC = centerC;
      let islandSums = {};
      allocs.forEach((a) => {
        let queue = [[a.seed.r, a.seed.c]];
        let qHead = 0;
        let visited = new Set([key(a.seed.r, a.seed.c)]);
        let placed = 0;
        let playerBlocks = blocksByPlayer.get(a.name);
        if (!playerBlocks) {
          playerBlocks = [];
          blocksByPlayer.set(a.name, playerBlocks);
        }

        while (qHead < queue.length && placed < a.count) {
          let [r, c] = queue[qHead++];
          let k = key(r, c);
          if (!owner.has(k)) {
            owner.set(k, a.name);
            playerBlocks.push([r, c]);
            ownerCoordList.push([r, c]);
            placed++;
            if (c > islandMaxC) islandMaxC = c;
            if (!islandSums[a.name]) islandSums[a.name] = { r: 0, c: 0, n: 0 };
            islandSums[a.name].r += r;
            islandSums[a.name].c += c;
            islandSums[a.name].n++;
          }
          const n0r = r - 1,
            n0c = c;
          const k0 = key(n0r, n0c);
          if (!visited.has(k0)) {
            visited.add(k0);
            queue.push([n0r, n0c]);
          }
          const n1r = r + 1,
            n1c = c;
          const k1 = key(n1r, n1c);
          if (!visited.has(k1)) {
            visited.add(k1);
            queue.push([n1r, n1c]);
          }
          const n2r = r,
            n2c = c - 1;
          const k2 = key(n2r, n2c);
          if (!visited.has(k2)) {
            visited.add(k2);
            queue.push([n2r, n2c]);
          }
          const n3r = r,
            n3c = c + 1;
          const k3 = key(n3r, n3c);
          if (!visited.has(k3)) {
            visited.add(k3);
            queue.push([n3r, n3c]);
          }
        }
      });

      Object.entries(islandSums).forEach(([name, s]) => {
        centroids.push({ name, r: s.r / s.n, c: s.c / s.n });
      });

      cursorC = islandMaxC + ISLAND_GAP;
    });
  }

  const beach = new Set();
  const beachCells = [];
  let minR = Infinity,
    maxR = -Infinity,
    minC = Infinity,
    maxC = -Infinity;

  for (let i = 0; i < ownerCoordList.length; i++) {
    const [r, c] = ownerCoordList[i];
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        const nk = key(nr, nc);
        if (!owner.has(nk) && !beach.has(nk)) {
          beach.add(nk);
          beachCells.push([nr, nc]);
          if (nr < minR) minR = nr;
          if (nr > maxR) maxR = nr;
          if (nc < minC) minC = nc;
          if (nc > maxC) maxC = nc;
        }
      }
    }
  }

  if (!isFinite(minR)) {
    minR = -5;
    maxR = 5;
    minC = -5;
    maxC = 5;
  }

  const world = {
    owner,
    blocksByPlayer,
    beach,
    beachCells,
    minR,
    maxR,
    minC,
    maxC,
    centroids,
  };

  worldStats.builds++;
  worldStats.lastBuildMs = performance.now() - t0;

  if (repoScores && typeof repoScores === "object") {
    worldCache.set(repoScores, {
      lpb,
      seatsRef: ISLAND_SEATS,
      world,
    });
  }

  return world;
}

function isAfk(name) {
  const spans = afkByPlayer[name];
  if (!spans) return false;
  return spans.some(
    ([s, e]) => currentFrameIndex >= s && currentFrameIndex < e
  );
}

function centroidFor(centroids, name, repoName) {
  const defaultRepo = window.CNC_DEFAULT_REPO || "default";
  const island = REPO_ISLANDS.find((i) => i.match(repoName || defaultRepo));
  const idx = REPO_ISLANDS.indexOf(island);
  let matches = centroids.filter((c) => c.name === name);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  matches.sort((a, b) => a.c - b.c);
  return idx === 0 ? matches[0] : matches[matches.length - 1];
}

function precomputeCamera(finalRepoScores) {
  const world = buildWorld(finalRepoScores);
  const viewW = Math.max(120, viewWidth - SB_WIDTH);
  const viewH = Math.max(120, viewHeight);
  const cols = world.maxC - world.minC + 1;
  const rows = world.maxR - world.minR + 1;

  let scale = Math.min(
    (viewW * VIEW_PAD) / (cols * CELL),
    (viewH * VIEW_PAD) / (rows * CELL)
  );
  scale = Math.max(0.15, Math.min(2.0, scale));
  cellPx = CELL * scale;

  const bboxCenterC = (world.minC + world.maxC) / 2;
  const bboxCenterR = (world.minR + world.maxR) / 2;
  baseOffsetX = SB_WIDTH + viewW / 2 - bboxCenterC * cellPx;
  baseOffsetY = viewH / 2 - bboxCenterR * cellPx;
}

function centerOnFrame(idx) {
  const w = buildWorld(getRepoScoresAtFrame(idx));
  const cc = (w.minC + w.maxC) / 2;
  const cr = (w.minR + w.maxR) / 2;
  const viewW = Math.max(120, viewWidth - SB_WIDTH);
  const viewH = Math.max(120, viewHeight);
  pan.x = SB_WIDTH + viewW / 2 - cc * cellPx - baseOffsetX;
  pan.y = viewH / 2 - cr * cellPx - baseOffsetY;
}
