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
}

// --- WORLD BUILD ---
function buildWorld(repoScores) {
  const owner = new Map();
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
        let visited = new Set();
        let placed = 0;
        while (queue.length > 0 && placed < a.count) {
          let [r, c] = queue.shift();
          let k = key(r, c);
          if (!owner.has(k)) {
            owner.set(k, a.name);
            placed++;
            if (c > islandMaxC) islandMaxC = c;
            if (!islandSums[a.name]) islandSums[a.name] = { r: 0, c: 0, n: 0 };
            islandSums[a.name].r += r;
            islandSums[a.name].c += c;
            islandSums[a.name].n++;
          }
          for (let [nr, nc] of [
            [r - 1, c],
            [r + 1, c],
            [r, c - 1],
            [r, c + 1],
          ]) {
            let nk = key(nr, nc);
            if (!visited.has(nk)) {
              visited.add(nk);
              queue.push([nr, nc]);
            }
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
  for (const k of owner.keys()) {
    let [r, c] = k.split(",").map(Number);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        let nk = key(r + dr, c + dc);
        if (!owner.has(nk)) beach.add(nk);
      }
    }
  }

  let minR = Infinity,
    maxR = -Infinity,
    minC = Infinity,
    maxC = -Infinity;
  const scan = (k) => {
    let [r, c] = k.split(",").map(Number);
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  };
  owner.forEach((_, k) => scan(k));
  beach.forEach((k) => scan(k));
  if (!isFinite(minR)) {
    minR = -5;
    maxR = 5;
    minC = -5;
    maxC = 5;
  }

  return { owner, beach, minR, maxR, minC, maxC, centroids };
}

function isAfk(name) {
  const spans = afkByPlayer[name];
  if (!spans) return false;
  return spans.some(
    ([s, e]) => currentFrameIndex >= s && currentFrameIndex < e
  );
}

function centroidFor(centroids, name, repoName) {
  const island = REPO_ISLANDS.find((i) => i.match(repoName || "vylor"));
  const idx = REPO_ISLANDS.indexOf(island);
  let matches = centroids.filter((c) => c.name === name);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  matches.sort((a, b) => a.c - b.c);
  return idx === 0 ? matches[0] : matches[matches.length - 1];
}

function precomputeCamera(finalRepoScores) {
  const world = buildWorld(finalRepoScores);
  const viewW = canvas.width - SB_WIDTH;
  const viewH = canvas.height;
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
  const viewW = canvas.width - SB_WIDTH;
  const viewH = canvas.height;
  pan.x = SB_WIDTH + viewW / 2 - cc * cellPx - baseOffsetX;
  pan.y = viewH / 2 - cr * cellPx - baseOffsetY;
}
