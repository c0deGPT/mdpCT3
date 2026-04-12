const imageFiles = Array.isArray(window.IMAGE_FILES) ? window.IMAGE_FILES : [];

const INITIAL_BATCH_SIZE = 24;
const TARGET_REVEAL_DURATION_MS = 4800;
const MIN_REMAINING_BATCH_SIZE = 20;
const MAX_REMAINING_BATCHES = 14;
const MIN_BATCH_DELAY_MS = 70;
const FIGURE_COUNT = 15;
const FIGURE_FILE = "1926277-200.png";
const SESSION_SEED = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const IMAGE_BASE_PATHS = buildAssetBases(
  window.IMAGE_BASE_PATHS,
  [
    "./images_processed/glow_scan_desaturated",
    "./glow_scan_desaturated",
    "./images_processed",
    "./assets/images_processed/glow_scan_desaturated",
    "./assets/glow_scan_desaturated",
    "../images_processed/glow_scan_desaturated",
    "../glow_scan_desaturated"
  ]
);
const FIGURE_BASE_PATHS = buildAssetBases(
  window.FIGURE_BASE_PATHS,
  [
    ".",
    "./images",
    "./assets",
    "./images_processed",
    "../",
    "../images",
    "../assets"
  ]
);

const stage = document.getElementById("stage");
const cloud = document.getElementById("cloud");
const figureCluster = document.getElementById("figureCluster");
let renderToken = 0;
let resizeTimer = null;
let activeImageBase = IMAGE_BASE_PATHS[0] || ".";
let activeFigureBase = FIGURE_BASE_PATHS[0] || ".";

function normalizeBasePath(basePath) {
  if (!basePath || basePath === ".") {
    return ".";
  }
  return `${basePath}`.replace(/[\\/]+$/, "");
}

function buildAssetBases(customBases, fallbackBases) {
  const list = Array.isArray(customBases) && customBases.length ? customBases : fallbackBases;
  return [...new Set(list.map(normalizeBasePath))];
}

function joinAssetPath(basePath, file) {
  const normalizedBase = normalizeBasePath(basePath);
  return normalizedBase === "." ? `./${file}` : `${normalizedBase}/${file}`;
}

function createPathCandidates(file, bases, preferredBase) {
  const queue = preferredBase ? [preferredBase, ...bases] : bases;
  return [...new Set(queue.map((base) => joinAssetPath(base, file)))];
}

function tryResolveImagePath(file, bases, preferredBase) {
  const candidates = createPathCandidates(file, bases, preferredBase);

  return new Promise((resolve) => {
    let index = 0;

    function attemptNext() {
      if (index >= candidates.length) {
        resolve({
          src: candidates[0],
          basePath: preferredBase || bases[0] || ".",
          width: 240,
          height: 180,
          found: false
        });
        return;
      }

      const src = candidates[index];
      index += 1;

      const img = new Image();
      img.decoding = "async";
      img.src = src;

      const finish = (found) => {
        resolve({
          src,
          basePath: src.slice(0, Math.max(0, src.length - file.length - 1)) || ".",
          width: img.naturalWidth || 240,
          height: img.naturalHeight || 180,
          found
        });
      };

      if (img.complete && img.naturalWidth > 0) {
        finish(true);
        return;
      }

      img.addEventListener("load", () => finish(true), { once: true });
      img.addEventListener("error", attemptNext, { once: true });
    }

    attemptNext();
  });
}

function attachSrcFallback(img, file, bases, preferredBase, onResolved) {
  const candidates = createPathCandidates(file, bases, preferredBase);
  const currentSrc = img.getAttribute("src");
  let index = candidates.indexOf(currentSrc);

  if (index === -1) {
    index = 0;
    img.src = candidates[index];
  }

  img.addEventListener(
    "error",
    () => {
      index += 1;
      if (index >= candidates.length) {
        return;
      }
      img.src = candidates[index];
    }
  );

  img.addEventListener(
    "load",
    () => {
      const matched = candidates[index] || img.currentSrc || img.src;
      const basePath = matched.slice(0, Math.max(0, matched.length - file.length - 1)) || ".";
      onResolved(basePath);
    },
    { once: true }
  );
}

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function loadImageMeta(file) {
  return tryResolveImagePath(file, IMAGE_BASE_PATHS, activeImageBase).then((result) => {
    if (result.found) {
      activeImageBase = normalizeBasePath(result.basePath);
    }

    return {
      file,
      src: result.src,
      width: result.width,
      height: result.height
    };
  });
}

function getRevealPlan(total) {
  const initialBatchSize = Math.min(total, INITIAL_BATCH_SIZE);
  const remainingCount = Math.max(0, total - initialBatchSize);

  if (remainingCount === 0) {
    return {
      initialBatchSize,
      batchSize: 0,
      batchDelayMs: 0
    };
  }

  const batchCount = Math.min(
    MAX_REMAINING_BATCHES,
    Math.max(1, Math.ceil(remainingCount / MIN_REMAINING_BATCH_SIZE))
  );

  return {
    initialBatchSize,
    batchSize: Math.ceil(remainingCount / batchCount),
    batchDelayMs: Math.max(
      MIN_BATCH_DELAY_MS,
      Math.floor(TARGET_REVEAL_DURATION_MS / batchCount)
    )
  };
}

function createRevealOrder(total, initialBatchSize = INITIAL_BATCH_SIZE) {
  const order = [];
  const stride = Math.max(1, Math.ceil(total / Math.max(1, initialBatchSize)));

  for (let offset = 0; offset < stride; offset += 1) {
    for (let index = offset; index < total; index += stride) {
      order.push(index);
    }
  }

  return order;
}

function getLayoutConfig(revealPlan) {
  const stageWidth = stage.clientWidth;
  const viewportHeight = window.innerHeight;
  const gutter = clamp(stageWidth * 0.012, 12, 22);
  const sceneHeight = Math.max(viewportHeight * 3.5, imageFiles.length * 31);

  stage.style.minHeight = `${Math.ceil(sceneHeight)}px`;
  cloud.style.minHeight = `${Math.ceil(sceneHeight)}px`;

  return {
    stageWidth,
    viewportHeight,
    gutter,
    sceneHeight,
    revealOrder: createRevealOrder(imageFiles.length, revealPlan.initialBatchSize),
    placedRects: [],
    reservedRects: [
      {
        x: stageWidth * 0.5 - Math.max(48, stageWidth * 0.09),
        y: Math.max(28, viewportHeight * 0.12),
        width: Math.max(96, stageWidth * 0.18),
        height: Math.max(180, viewportHeight * 0.58)
      }
    ]
  };
}

function buildFigures(layout) {
  figureCluster.innerHTML = "";
  const minY = Math.max(48, layout.viewportHeight * 0.08);
  const maxY = Math.max(minY + 120, layout.sceneHeight - layout.viewportHeight * 0.12);
  const figureSrc = joinAssetPath(activeFigureBase, FIGURE_FILE);

  for (let index = 0; index < FIGURE_COUNT; index += 1) {
    const random = createSeededRandom(hashString(`${SESSION_SEED}-figure-${index}`));
    const progress = index / Math.max(1, FIGURE_COUNT - 1);
    const xBand = random() > 0.5 ? [0.1, 0.42] : [0.58, 0.9];
    const x = layout.stageWidth * (xBand[0] + random() * (xBand[1] - xBand[0]));
    const y = minY + progress * (maxY - minY) + (random() - 0.5) * layout.viewportHeight * 0.14;
    const width = layout.stageWidth < 720
      ? 20 + random() * 16
      : 24 + random() * 20;
    const opacity = 0.72 + random() * 0.18;

    const figure = document.createElement("img");
    figure.className = "figure-image";
    figure.src = figureSrc;
    figure.alt = "";
    figure.style.left = `${x.toFixed(1)}px`;
    figure.style.top = `${clamp(y, minY, maxY).toFixed(1)}px`;
    figure.style.width = `${width.toFixed(1)}px`;
    figure.style.setProperty("--figure-opacity", opacity.toFixed(2));
    attachSrcFallback(figure, FIGURE_FILE, FIGURE_BASE_PATHS, activeFigureBase, (resolvedBase) => {
      activeFigureBase = normalizeBasePath(resolvedBase);
    });
    figureCluster.appendChild(figure);
  }
}

function computeScale(naturalW, naturalH, stageWidth) {
  const baseScale = clamp(stageWidth / 1600, 0.24, 0.48);
  const area = naturalW * naturalH;
  let adjusted = baseScale;
  if (area > 180000) {
    adjusted *= 0.8;
  } else if (area < 38000) {
    adjusted *= 1.12;
  }
  return adjusted * 1.05;
}

function rectsOverlap(a, b, gap = 14) {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

function collides(rect, layout) {
  for (const reserved of layout.reservedRects) {
    if (rectsOverlap(rect, reserved, 18)) {
      return true;
    }
  }
  for (const placed of layout.placedRects) {
    if (rectsOverlap(rect, placed, 8)) {
      return true;
    }
  }
  return false;
}

function choosePosition(width, height, index, file, layout) {
  const random = createSeededRandom(hashString(`${SESSION_SEED}-${file}`));
  const maxX = Math.max(layout.gutter, layout.stageWidth - width - layout.gutter);
  const maxY = Math.max(layout.gutter, layout.sceneHeight - height - layout.gutter);
  const anchorY = clamp(
    layout.gutter + random() * (layout.sceneHeight - height - layout.gutter * 2),
    layout.gutter,
    maxY
  );
  const band = Math.max(layout.viewportHeight * 0.28, 220);

  for (let attempt = 0; attempt < 160; attempt += 1) {
    const x = clamp(
      layout.gutter + random() * (layout.stageWidth - width - layout.gutter * 2),
      layout.gutter,
      maxX
    );

    let y;
    if (attempt < 110) {
      y = clamp(anchorY + (random() - 0.5) * band * 1.6, layout.gutter, maxY);
    } else {
      y = clamp(layout.gutter + random() * (layout.sceneHeight - height - layout.gutter * 2), layout.gutter, maxY);
    }

    const rect = { x, y, width, height };
    if (!collides(rect, layout)) {
      return { rect, rotation: (random() - 0.5) * 7.5 };
    }
  }

  const currentBottom = layout.placedRects.length
    ? Math.max(...layout.placedRects.map((rect) => rect.y + rect.height))
    : layout.gutter;
  const fallbackRect = {
    x: clamp(
      layout.gutter + random() * (layout.stageWidth - width - layout.gutter * 2),
      layout.gutter,
      maxX
    ),
    y: currentBottom + layout.gutter * (1.5 + random()),
    width,
    height
  };

  layout.sceneHeight = Math.max(layout.sceneHeight, fallbackRect.y + height + layout.gutter * 3);
  stage.style.minHeight = `${Math.ceil(layout.sceneHeight)}px`;
  cloud.style.minHeight = `${Math.ceil(layout.sceneHeight)}px`;

  return { rect: fallbackRect, rotation: (random() - 0.5) * 7.5 };
}

function beginDrag(event, tile) {
  const rect = tile.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const startOffsetX = event.clientX - rect.left;
  const startOffsetY = event.clientY - rect.top;
  tile.classList.add("is-dragging");
  tile.setPointerCapture(event.pointerId);

  function move(moveEvent) {
    const width = rect.width;
    const height = rect.height;
    const x = clamp(
      moveEvent.clientX - stageRect.left - startOffsetX,
      8,
      stageRect.width - width - 8
    );
    const y = clamp(
      moveEvent.clientY - stageRect.top - startOffsetY,
      8,
      stage.offsetHeight - height - 8
    );
    tile.style.left = `${x}px`;
    tile.style.top = `${y}px`;
  }

  function end(pointerEvent) {
    tile.classList.remove("is-dragging");
    tile.releasePointerCapture(pointerEvent.pointerId);
    tile.removeEventListener("pointermove", move);
    tile.removeEventListener("pointerup", end);
    tile.removeEventListener("pointercancel", end);
  }

  tile.addEventListener("pointermove", move);
  tile.addEventListener("pointerup", end);
  tile.addEventListener("pointercancel", end);
}

function createTile(meta, index, layout, eager = false) {
  const figure = document.createElement("figure");
  figure.className = "tile is-pending";
  figure.tabIndex = 0;
  figure.dataset.file = meta.file;

  if (index % 9 === 0 || index === 10) {
    figure.classList.add("featured");
  }

  const scale = computeScale(meta.width, meta.height, layout.stageWidth);
  const width = meta.width * scale;
  const height = meta.height * scale;
  const placement = choosePosition(width, height, index, meta.file, layout);
  layout.placedRects.push(placement.rect);

  figure.style.width = `${width}px`;
  figure.style.left = `${placement.rect.x}px`;
  figure.style.top = `${placement.rect.y}px`;
  figure.style.setProperty("--tile-rotation", `${placement.rotation.toFixed(2)}deg`);
  figure.style.zIndex = `${10 + index}`;

  const img = document.createElement("img");
  img.alt = `Pareidolia fragment ${index + 1}`;
  img.loading = eager ? "eager" : "lazy";
  img.decoding = "async";
  if (eager && index < 8) {
    img.fetchPriority = "high";
  }
  img.src = meta.src || joinAssetPath(activeImageBase, meta.file);
  attachSrcFallback(img, meta.file, IMAGE_BASE_PATHS, activeImageBase, (resolvedBase) => {
    activeImageBase = normalizeBasePath(resolvedBase);
  });
  figure.appendChild(img);

  img.addEventListener(
    "load",
    () => {
      requestAnimationFrame(() => {
        figure.classList.remove("is-pending");
      });
    },
    { once: true }
  );

  figure.addEventListener("pointerdown", (event) => beginDrag(event, figure));
  figure.addEventListener("click", () => {
    document.querySelectorAll(".tile.is-active").forEach((node) => {
      node.classList.remove("is-active");
    });
    figure.classList.add("is-active");
  });

  return figure;
}

async function appendBatch(startIndex, count, token, layout, eager = false) {
  if (token !== renderToken) {
    return startIndex;
  }

  const revealOrder = layout.revealOrder;
  const endIndex = Math.min(startIndex + count, revealOrder.length);
  const batchIndices = revealOrder.slice(startIndex, endIndex);
  const metas = await Promise.all(
    batchIndices.map((imageIndex) => loadImageMeta(imageFiles[imageIndex]))
  );

  if (token !== renderToken) {
    return endIndex;
  }

  metas.forEach((meta, offset) => {
    const index = batchIndices[offset];
    const tile = createTile(meta, index, layout, eager);
    cloud.appendChild(tile);
  });

  return endIndex;
}

function queueRemainingBatches(startIndex, token, layout, revealPlan) {
  if (token !== renderToken || startIndex >= imageFiles.length) {
    return;
  }

  const schedule = () => {
    window.setTimeout(async () => {
      if (token !== renderToken) {
        return;
      }
      const nextIndex = await appendBatch(startIndex, revealPlan.batchSize, token, layout, false);
      queueRemainingBatches(nextIndex, token, layout, revealPlan);
    }, revealPlan.batchDelayMs);
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(schedule, { timeout: 250 });
  } else {
    schedule();
  }
}

async function rebuildLayout() {
  renderToken += 1;
  const token = renderToken;
  cloud.innerHTML = "";

  const revealPlan = getRevealPlan(imageFiles.length);
  const layout = getLayoutConfig(revealPlan);
  buildFigures(layout);
  const nextIndex = await appendBatch(0, revealPlan.initialBatchSize, token, layout, true);
  queueRemainingBatches(nextIndex, token, layout, revealPlan);
}

window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    rebuildLayout();
  }, 180);
});

rebuildLayout();
