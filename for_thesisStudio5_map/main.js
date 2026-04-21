const sourceImageFiles = Array.isArray(window.IMAGE_FILES) ? window.IMAGE_FILES : [];
const imageFiles = sourceImageFiles.filter((_, index) => index % 4 === 0);
const pageImageGroups = [[], []];

imageFiles.forEach((file, index) => {
  pageImageGroups[index % 2].push(file);
});

const INITIAL_BATCH_SIZE = 14;
const TARGET_REVEAL_DURATION_MS = 2600;
const MIN_REMAINING_BATCH_SIZE = 10;
const MAX_REMAINING_BATCHES = 8;
const MIN_BATCH_DELAY_MS = 70;
const FIGURE_COUNT = 6;
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
const pageToggle = document.getElementById("pageToggle");
const pageToggleArrow = document.getElementById("pageToggleArrow");
const scenes = [
  {
    index: 0,
    root: document.getElementById("scene0"),
    connectionLayer: document.getElementById("connections0"),
    cloud: document.getElementById("cloud0"),
    figureCluster: document.getElementById("figureCluster0"),
    files: pageImageGroups[0]
  },
  {
    index: 1,
    root: document.getElementById("scene1"),
    connectionLayer: document.getElementById("connections1"),
    cloud: document.getElementById("cloud1"),
    figureCluster: document.getElementById("figureCluster1"),
    files: pageImageGroups[1]
  }
];

let renderToken = 0;
let resizeTimer = null;
let activeImageBase = IMAGE_BASE_PATHS[0] || ".";
let activeFigureBase = FIGURE_BASE_PATHS[0] || ".";
let currentPageIndex = 0;
const SVG_NS = "http://www.w3.org/2000/svg";

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
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
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

function getNodeMetrics(node, sceneRect) {
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return {
    x: rect.left - sceneRect.left,
    y: rect.top - sceneRect.top,
    width: rect.width,
    height: rect.height,
    centerX: rect.left - sceneRect.left + rect.width / 2,
    centerY: rect.top - sceneRect.top + rect.height / 2
  };
}

function getAnchorPoint(metrics, targetX) {
  const useRightSide = targetX >= metrics.centerX;
  return {
    x: useRightSide ? metrics.x + metrics.width : metrics.x,
    y: metrics.centerY
  };
}

function pickConnectionFigure(tileMetrics, figureMetrics, seedKey) {
  if (!figureMetrics.length) {
    return null;
  }

  const rankedFigures = [...figureMetrics].sort((a, b) => {
    const distanceA = Math.hypot(tileMetrics.centerX - a.centerX, tileMetrics.centerY - a.centerY);
    const distanceB = Math.hypot(tileMetrics.centerX - b.centerX, tileMetrics.centerY - b.centerY);
    return distanceA - distanceB;
  });

  const random = createSeededRandom(hashString(`${SESSION_SEED}-${seedKey}-connection`));
  const choiceRange = Math.min(3, rankedFigures.length);
  const choiceIndex = Math.min(choiceRange - 1, Math.floor(random() * choiceRange));
  return rankedFigures[choiceIndex];
}

function buildConnectionPath(startPoint, endPoint, seedKey, sceneRect) {
  const random = createSeededRandom(hashString(`${SESSION_SEED}-${seedKey}-path`));
  const dx = endPoint.x - startPoint.x;
  const curveX = clamp(Math.abs(dx) * (0.18 + random() * 0.16), 42, sceneRect.width * 0.2);
  const curveY = (random() - 0.5) * clamp(sceneRect.height * 0.28, 90, 220);
  const direction = dx >= 0 ? 1 : -1;

  const cp1x = startPoint.x + curveX * direction;
  const cp1y = startPoint.y + curveY;
  const cp2x = endPoint.x - curveX * direction;
  const cp2y = endPoint.y - curveY;

  return `M ${startPoint.x.toFixed(1)} ${startPoint.y.toFixed(1)} C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${endPoint.x.toFixed(1)} ${endPoint.y.toFixed(1)}`;
}

function renderSceneConnections(scene) {
  if (!scene.connectionLayer) {
    return;
  }

  const sceneRect = scene.root.getBoundingClientRect();
  const figureNodes = Array.from(scene.figureCluster.querySelectorAll(".figure-image"));
  const tileNodes = Array.from(scene.cloud.querySelectorAll(".tile"));

  scene.connectionLayer.setAttribute("viewBox", `0 0 ${sceneRect.width} ${sceneRect.height}`);
  scene.connectionLayer.setAttribute("preserveAspectRatio", "none");

  if (!figureNodes.length || !tileNodes.length) {
    scene.connectionLayer.replaceChildren();
    return;
  }

  const figureMetrics = figureNodes
    .map((node) => getNodeMetrics(node, sceneRect))
    .filter(Boolean);

  const fragment = document.createDocumentFragment();

  tileNodes.forEach((tile, index) => {
    const tileMetrics = getNodeMetrics(tile, sceneRect);
    if (!tileMetrics) {
      return;
    }

    const seedKey = `${scene.index}-${tile.dataset.file || index}-${index}`;
    const figureMetricsTarget = pickConnectionFigure(tileMetrics, figureMetrics, seedKey);
    if (!figureMetricsTarget) {
      return;
    }

    const startPoint = getAnchorPoint(figureMetricsTarget, tileMetrics.centerX);
    const endPoint = getAnchorPoint(tileMetrics, figureMetricsTarget.centerX);
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "connection-path");
    path.setAttribute("d", buildConnectionPath(startPoint, endPoint, seedKey, sceneRect));
    fragment.appendChild(path);
  });

  scene.connectionLayer.replaceChildren(fragment);
}

function scheduleSceneConnections(scene) {
  if (scene.connectionFrame) {
    return;
  }

  scene.connectionFrame = window.requestAnimationFrame(() => {
    scene.connectionFrame = null;
    renderSceneConnections(scene);
  });
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

function getLayoutConfig(scene, revealPlan) {
  const stageWidth = stage.clientWidth;
  const viewportHeight = window.innerHeight;
  const gutter = clamp(stageWidth * 0.012, 12, 24);

  return {
    stageWidth,
    viewportHeight,
    gutter,
    sceneHeight: viewportHeight,
    revealOrder: createRevealOrder(scene.files.length, revealPlan.initialBatchSize),
    placedRects: [],
    reservedRects: [
      {
        x: 0,
        y: 0,
        width: Math.max(200, stageWidth * 0.28),
        height: Math.max(72, viewportHeight * 0.12)
      },
      {
        x: stageWidth - Math.max(86, stageWidth * 0.12),
        y: 0,
        width: Math.max(86, stageWidth * 0.12),
        height: Math.max(72, viewportHeight * 0.12)
      }
    ],
    scene
  };
}

function buildFigures(scene, layout) {
  scene.figureCluster.innerHTML = "";
  const minY = Math.max(72, layout.viewportHeight * 0.14);
  const maxY = Math.max(minY + 120, layout.viewportHeight - 42);
  const figureSrc = joinAssetPath(activeFigureBase, FIGURE_FILE);

  for (let index = 0; index < FIGURE_COUNT; index += 1) {
    const random = createSeededRandom(hashString(`${SESSION_SEED}-page-${scene.index}-figure-${index}`));
    const progress = index / Math.max(1, FIGURE_COUNT - 1);
    const xBand = random() > 0.5 ? [0.06, 0.22] : [0.78, 0.94];
    const x = layout.stageWidth * (xBand[0] + random() * (xBand[1] - xBand[0]));
    const y = minY + progress * (maxY - minY) + (random() - 0.5) * layout.viewportHeight * 0.16;
    const width = layout.stageWidth < 720
      ? 10 + random() * 6
      : 12 + random() * 8;
    const opacity = 0.36 + random() * 0.12;

    const figure = document.createElement("img");
    figure.className = "figure-image";
    figure.src = figureSrc;
    figure.alt = "";
    figure.style.left = `${x.toFixed(1)}px`;
    figure.style.top = `${clamp(y, minY, maxY).toFixed(1)}px`;
    figure.style.width = `${width.toFixed(1)}px`;
    figure.style.setProperty("--figure-opacity", opacity.toFixed(2));
    figure.addEventListener("load", () => scheduleSceneConnections(scene), { once: true });
    if (figure.complete && figure.naturalWidth > 0) {
      scheduleSceneConnections(scene);
    }
    attachSrcFallback(figure, FIGURE_FILE, FIGURE_BASE_PATHS, activeFigureBase, (resolvedBase) => {
      activeFigureBase = normalizeBasePath(resolvedBase);
    });
    scene.figureCluster.appendChild(figure);
  }
}

function computeScale(naturalW, naturalH, stageWidth) {
  const baseScale = clamp(stageWidth / 1900, 0.18, 0.3);
  const area = naturalW * naturalH;
  let adjusted = baseScale;
  if (area > 65000) {
    adjusted *= 0.86;
  } else if (area < 18000) {
    adjusted *= 1.12;
  }
  return adjusted * 1.4;
}

function rectsOverlap(a, b, gap = 8) {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

function collides(rect, layout) {
  for (const reserved of layout.reservedRects) {
    if (rectsOverlap(rect, reserved, 14)) {
      return true;
    }
  }
  for (const placed of layout.placedRects) {
    if (rectsOverlap(rect, placed, 4)) {
      return true;
    }
  }
  return false;
}

function choosePosition(width, height, file, layout, sceneIndex) {
  const random = createSeededRandom(hashString(`${SESSION_SEED}-page-${sceneIndex}-${file}`));
  const maxX = Math.max(layout.gutter, layout.stageWidth - width - layout.gutter);
  const maxY = Math.max(layout.gutter, layout.sceneHeight - height - layout.gutter);
  const topLimit = Math.max(layout.gutter + 64, layout.viewportHeight * 0.12);
  const anchorY = clamp(
    topLimit + random() * Math.max(24, layout.sceneHeight - height - topLimit - layout.gutter),
    topLimit,
    maxY
  );
  const band = Math.max(layout.viewportHeight * 0.24, 180);

  for (let attempt = 0; attempt < 160; attempt += 1) {
    const x = clamp(
      layout.gutter + random() * (layout.stageWidth - width - layout.gutter * 2),
      layout.gutter,
      maxX
    );

    let y;
    if (attempt < 110) {
      y = clamp(anchorY + (random() - 0.5) * band * 1.6, topLimit, maxY);
    } else {
      y = clamp(
        topLimit + random() * Math.max(24, layout.sceneHeight - height - topLimit - layout.gutter),
        topLimit,
        maxY
      );
    }

    const rect = { x, y, width, height };
    if (!collides(rect, layout)) {
      return { rect, rotation: (random() - 0.5) * 7.5 };
    }
  }

  return {
    rect: {
      x: clamp(layout.stageWidth * 0.5 - width * 0.5, layout.gutter, maxX),
      y: clamp(layout.sceneHeight * 0.5 - height * 0.5, topLimit, maxY),
      width,
      height
    },
    rotation: (random() - 0.5) * 5.5
  };
}

function beginDrag(event, tile, scene) {
  const rect = tile.getBoundingClientRect();
  const sceneRect = scene.root.getBoundingClientRect();
  const startOffsetX = event.clientX - rect.left;
  const startOffsetY = event.clientY - rect.top;
  tile.classList.add("is-dragging");
  tile.setPointerCapture(event.pointerId);

  function move(moveEvent) {
    const width = rect.width;
    const height = rect.height;
    const x = clamp(
      moveEvent.clientX - sceneRect.left - startOffsetX,
      8,
      sceneRect.width - width - 8
    );
    const y = clamp(
      moveEvent.clientY - sceneRect.top - startOffsetY,
      8,
      sceneRect.height - height - 8
    );
    tile.style.left = `${x}px`;
    tile.style.top = `${y}px`;
    scheduleSceneConnections(scene);
  }

  function end(pointerEvent) {
    tile.classList.remove("is-dragging");
    tile.releasePointerCapture(pointerEvent.pointerId);
    tile.removeEventListener("pointermove", move);
    tile.removeEventListener("pointerup", end);
    tile.removeEventListener("pointercancel", end);
    scheduleSceneConnections(scene);
  }

  tile.addEventListener("pointermove", move);
  tile.addEventListener("pointerup", end);
  tile.addEventListener("pointercancel", end);
}

function createTile(meta, index, layout, scene, eager = false) {
  const figure = document.createElement("figure");
  figure.className = "tile is-pending";
  figure.tabIndex = 0;
  figure.dataset.file = meta.file;
  figure.dataset.page = `${scene.index}`;

  if (index % 8 === 0 || index === 5) {
    figure.classList.add("featured");
  }

  const scale = computeScale(meta.width, meta.height, layout.stageWidth);
  const width = meta.width * scale;
  const height = meta.height * scale;
  const placement = choosePosition(width, height, meta.file, layout, scene.index);
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
  if (eager && index < 6) {
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
        scheduleSceneConnections(scene);
      });
    },
    { once: true }
  );

  if (img.complete && img.naturalWidth > 0) {
    requestAnimationFrame(() => {
      figure.classList.remove("is-pending");
      scheduleSceneConnections(scene);
    });
  }

  figure.addEventListener("pointerdown", (event) => beginDrag(event, figure, scene));
  figure.addEventListener("click", () => {
    scene.root.querySelectorAll(".tile.is-active").forEach((node) => {
      node.classList.remove("is-active");
    });
    figure.classList.add("is-active");
  });

  return figure;
}

async function appendBatch(startIndex, count, token, layout, scene, eager = false) {
  if (token !== renderToken) {
    return startIndex;
  }

  const revealOrder = layout.revealOrder;
  const endIndex = Math.min(startIndex + count, revealOrder.length);
  const batchIndices = revealOrder.slice(startIndex, endIndex);
  const metas = await Promise.all(
    batchIndices.map((imageIndex) => loadImageMeta(scene.files[imageIndex]))
  );

  if (token !== renderToken) {
    return endIndex;
  }

  metas.forEach((meta, offset) => {
    const index = batchIndices[offset];
    const tile = createTile(meta, index, layout, scene, eager);
    scene.cloud.appendChild(tile);
  });

  scheduleSceneConnections(scene);

  return endIndex;
}

function queueRemainingBatches(startIndex, token, layout, scene, revealPlan) {
  if (token !== renderToken || startIndex >= scene.files.length) {
    return;
  }

  const schedule = () => {
    window.setTimeout(async () => {
      if (token !== renderToken) {
        return;
      }
      const nextIndex = await appendBatch(startIndex, revealPlan.batchSize, token, layout, scene, false);
      queueRemainingBatches(nextIndex, token, layout, scene, revealPlan);
    }, revealPlan.batchDelayMs);
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(schedule, { timeout: 250 });
  } else {
    schedule();
  }
}

function updateToggleUI() {
  const nextPageIndex = currentPageIndex === 0 ? 1 : 0;
  pageToggleArrow.textContent = currentPageIndex === 0 ? "\u2192" : "\u2190";
  pageToggle.setAttribute("aria-label", `Go to page ${nextPageIndex + 1}`);
}

function setActivePage(index) {
  currentPageIndex = index;
  scenes.forEach((scene) => {
    scene.root.classList.toggle("is-active", scene.index === currentPageIndex);
  });
  updateToggleUI();
}

function togglePage() {
  setActivePage(currentPageIndex === 0 ? 1 : 0);
}

async function rebuildLayout() {
  renderToken += 1;
  const token = renderToken;

  scenes.forEach((scene) => {
    if (scene.connectionFrame) {
      window.cancelAnimationFrame(scene.connectionFrame);
      scene.connectionFrame = null;
    }
    scene.connectionLayer.replaceChildren();
    scene.cloud.innerHTML = "";
    scene.figureCluster.innerHTML = "";
  });

  const buildTasks = scenes.map(async (scene) => {
    const revealPlan = getRevealPlan(scene.files.length);
    const layout = getLayoutConfig(scene, revealPlan);
    buildFigures(scene, layout);
    scheduleSceneConnections(scene);
    const nextIndex = await appendBatch(0, revealPlan.initialBatchSize, token, layout, scene, true);
    queueRemainingBatches(nextIndex, token, layout, scene, revealPlan);
  });

  await Promise.all(buildTasks);
}

pageToggle.addEventListener("click", togglePage);

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight" && currentPageIndex === 0) {
    togglePage();
  } else if (event.key === "ArrowLeft" && currentPageIndex === 1) {
    togglePage();
  }
});

window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    rebuildLayout();
  }, 180);
});

setActivePage(0);
rebuildLayout();
