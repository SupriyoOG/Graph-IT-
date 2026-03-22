const FPS = 240;
const TIME_WRAP_SECONDS = 60;
const TRAIL_ENABLED = true;
const TRAIL_LENGTH = 10;
const TRAIL_WIDTH = 2;
const TRAIL_FADE = Math.max(0.02, Math.min(0.35, 1 / TRAIL_LENGTH));
const GRAPH_STROKE_WIDTH = 1;
const GRAPH_GLOW_ENABLED = true;
const GRAPH_GLOW_RADIUS = 10;
const GRAPH_GLOW_STROKE_WIDTH = 2;

const canvas = document.getElementById("graph");
const ctx = canvas.getContext("2d");
const trailCanvas = document.createElement("canvas");
const trailCtx = trailCanvas.getContext("2d");
const rowsEl = document.getElementById("rows");
const paramsEl = document.getElementById("params");
const rowTemplate = document.getElementById("rowTemplate");
const paramTemplate = document.getElementById("paramTemplate");
const addRowBtn = document.getElementById("addRowBtn");
const addParamBtn = document.getElementById("addParamBtn");
const toggleAnimateBtn = document.getElementById("toggleAnimateBtn");
const toggleModeBtn = document.getElementById("toggleModeBtn");
const resetTimeBtn = document.getElementById("resetTimeBtn");
const resetViewBtn = document.getElementById("resetViewBtn");
const statusText = document.getElementById("statusText");
const paramStatus = document.getElementById("paramStatus");
const mouseXEl = document.getElementById("mouseX");
const mouseYEl = document.getElementById("mouseY");
const timeValueEl = document.getElementById("timeValue");

const ALLOWED_NAMES = {
  pi: Math.PI,
  PI: Math.PI,
  e: Math.E,
  E: Math.E,
  abs: Math.abs,
  sqrt: Math.sqrt,
  pow: Math.pow,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  trunc: Math.trunc,
  min: Math.min,
  max: Math.max,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  ln: Math.log,
  exp: Math.exp,
  cbrt: Math.cbrt,
  hypot: Math.hypot,
  sign: Math.sign,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  asinh: Math.asinh,
  acosh: Math.acosh,
  atanh: Math.atanh,
  clamp: (v, a, b) => Math.min(Math.max(v, a), b),
  lerp: (a, b, t) => a + (b - a) * t,
  frac: (v) => v - Math.floor(v),
  deg: (r) => (r * 180) / Math.PI,
  rad: (d) => (d * Math.PI) / 180,
};

const BUILTIN_NAMES = new Set(Object.keys(ALLOWED_NAMES));
const RESERVED_NAMES = new Set([
  ...Object.keys(ALLOWED_NAMES),
  "x",
  "y",
  "t",
  "time",
  "n",
  "tau",
  "rand",
]);

const state = {
  rows: [],
  params: [],
  nextRowId: 1,
  nextParamId: 1,
  t: 0,
  tAccumulator: 0,
  animateT: true,
  combinedMode: false,
  view: { x: 0, y: 0, scale: 60 },
  mouse: { x: 0, y: 0, inside: false },
  activeTimeRows: 0,
  needsRender: true,
  renderQueued: false,
  lastFrameTime: 0,
};

function scheduleRender() {
  state.needsRender = true;
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(frame);
}

function clearTrail() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  trailCanvas.width = Math.max(1, Math.round(rect.width * dpr));
  trailCanvas.height = Math.max(1, Math.round(rect.height * dpr));
  trailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  trailCtx.clearRect(0, 0, rect.width, rect.height);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "∞";
  const abs = Math.abs(value);
  if ((abs !== 0 && abs < 1e-4) || abs >= 1e6) return value.toExponential(4);
  return value
    .toFixed(4)
    .replace(/\.0+$/, "")
    .replace(/(\.[0-9]*?)0+$/, "$1");
}

function formatCoord(value) {
  if (!Number.isFinite(value)) return "∞";
  return value.toFixed(1);
}

function normalizeExpression(input) {
  let expr = input.trim();
  if (!expr) return "";

  expr = expr.replace(/\^/g, "**");
  expr = expr.replace(/\bπ\b/g, "pi");
  expr = expr.replace(/\bln\s*\(/g, "log(");

  const tokens =
    expr.match(
      /\s+|(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?|[A-Za-z_]\w*|\*\*|[+\-*/(),]/gi
    ) || [];
  const out = [];
  let prev = null;

  const isNum = (tok) => /^\d/.test(tok);
  const isId = (tok) => /^[A-Za-z_]\w*$/.test(tok);
  const isOpen = (tok) => tok === "(";
  const isClose = (tok) => tok === ")";

  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) continue;

    if (prev) {
      const prevType = isNum(prev)
        ? "num"
        : isId(prev)
        ? "id"
        : isClose(prev)
        ? "close"
        : "other";
      const curType = isNum(tok)
        ? "num"
        : isId(tok)
        ? "id"
        : isOpen(tok)
        ? "open"
        : "other";
      const prevIsFunc = prevType === "id" && BUILTIN_NAMES.has(prev);

      if (
        (prevType === "num" && (curType === "id" || curType === "open")) ||
        (prevType === "close" &&
          (curType === "id" || curType === "num" || curType === "open")) ||
        (prevType === "id" &&
          !prevIsFunc &&
          (curType === "id" || curType === "num" || curType === "open"))
      ) {
        out.push("*");
      }
    }

    out.push(tok);
    prev = tok;
  }

  return out.join("");
}

function compileExpression(expr) {
  const keys = Object.keys(ALLOWED_NAMES);
  return new Function(
    "scope",
    `const { ${keys.join(", ")} } = scope; with (scope) { return (${expr}); }`
  );
}

function buildRuntimeScope(x, t) {
  const scope = {
    ...ALLOWED_NAMES,
    x,
    y: undefined,
    t,
    time: t,
    n: x,
    tau: Math.PI * 2,
    rand: Math.random,
  };

  for (const param of state.params) {
    if (param.status === "ok") scope[param.name] = param.value;
  }

  return scope;
}

function evaluateWithScope(fn, x, t) {
  try {
    return fn(buildRuntimeScope(x, t));
  } catch {
    return null;
  }
}

function looksIncomplete(message) {
  return /unexpected end|unexpected token|missing|unterminated|invalid left-hand|missing \)|missing \]|missing \}/i.test(
    message
  );
}

function scanIdentifiers(expr) {
  return expr.match(/[A-Za-z_]\w*/g) || [];
}

function updateActiveTimeRows() {
  state.activeTimeRows = state.rows.filter(
    (r) => r.visible && r.compileStatus === "ok" && r.usesTime
  ).length;
}

function updateStatus() {
  const total = state.rows.length;
  const visible = state.rows.filter((r) => r.visible).length;
  const live = state.rows.filter((r) => r.compileStatus === "ok").length;
  const pending = state.rows.filter(
    (r) => r.compileStatus === "pending"
  ).length;
  const error = state.rows.filter((r) => r.compileStatus === "error").length;
  const paramCount = state.params.filter((p) => p.status === "ok").length;
  const mode = state.combinedMode ? "combined" : "separate";

  statusText.textContent = `${total} rows • ${visible} visible • ${live} live${
    pending ? ` • ${pending} waiting` : ""
  }${error ? ` • ${error} error` : ""} • ${mode}`;
  paramStatus.textContent = `${paramCount} set`;
}

function syncRowPreview(row) {
  if (row.compileStatus !== "ok" || !row.compiled) {
    if (!row.expr.trim()) row.previewValue.textContent = "empty";
    return;
  }

  const sample = evaluateWithScope(row.compiled, 1, state.t);
  if (typeof sample === "number" && Number.isFinite(sample)) {
    row.previewValue.textContent = formatNumber(sample);
  } else {
    row.previewValue.textContent = "...";
  }
}

function syncParamPreview(param) {
  if (param.status === "ok") {
    param.resultEl.textContent = formatNumber(param.value);
  } else {
    param.resultEl.textContent = param.status === "pending" ? "..." : "syntax";
  }
}

function compileRow(row) {
  const raw = row.expr.trim();
  row.compiled = null;
  row.compileStatus = "pending";
  row.usesTime = false;

  if (!raw) {
    row.previewValue.textContent = "empty";
    updateActiveTimeRows();
    return;
  }

  const expr = normalizeExpression(raw);
  try {
    row.compiled = compileExpression(expr);
    row.compileStatus = "ok";
    const ids = scanIdentifiers(expr);
    row.usesTime = ids.includes("t") || ids.includes("time");
    syncRowPreview(row);
  } catch (err) {
    const message = String(err?.message ?? err);
    if (looksIncomplete(message)) {
      row.compileStatus = "pending";
      row.previewValue.textContent = "...";
    } else {
      row.compileStatus = "error";
      row.previewValue.textContent = "syntax";
    }
  }

  updateActiveTimeRows();
}

function compileParam(param) {
  const name = param.nameInput.value.trim();
  const valueExpr = param.valueInput.value.trim();
  param.status = "pending";
  param.value = 0;

  if (!name || !valueExpr) {
    param.status = "pending";
    param.resultEl.textContent = "...";
    return false;
  }

  if (!/^[A-Za-z_]\w*$/.test(name) || RESERVED_NAMES.has(name)) {
    param.status = "error";
    param.resultEl.textContent = "name";
    return false;
  }

  const duplicate = state.params.some(
    (other) => other !== param && other.status === "ok" && other.name === name
  );
  if (duplicate) {
    param.status = "error";
    param.resultEl.textContent = "dup";
    return false;
  }

  const expr = normalizeExpression(valueExpr);
  const ids = scanIdentifiers(expr);
  for (const id of ids) {
    if (!BUILTIN_NAMES.has(id)) {
      param.status = "error";
      param.resultEl.textContent = "no refs";
      return false;
    }
  }

  try {
    const fn = compileExpression(expr);
    const value = evaluateWithScope(fn, 0, 0);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      param.status = "error";
      param.resultEl.textContent = "syntax";
      return false;
    }
    param.status = "ok";
    param.value = value;
    param.name = name;
    param.compiled = fn;
    param.normalized = expr;
    param.resultEl.textContent = formatNumber(value);
    return true;
  } catch (err) {
    const message = String(err?.message ?? err);
    if (looksIncomplete(message)) {
      param.status = "pending";
      param.resultEl.textContent = "...";
    } else {
      param.status = "error";
      param.resultEl.textContent = "syntax";
    }
    return false;
  }
}

function rebuildAllPreviews() {
  for (const row of state.rows) syncRowPreview(row);
  for (const param of state.params) syncParamPreview(param);
}

function refreshParameters() {
  for (const row of state.rows) {
    if (!row.expr.trim()) continue;
    compileRow(row);
  }

  rebuildAllPreviews();
  updateActiveTimeRows();
  updateStatus();
  scheduleRender();
}

function createRow(expr = "") {
  const id = state.nextRowId++;
  const frag = rowTemplate.content.cloneNode(true);
  const rowEl = frag.querySelector(".item-row");
  const input = frag.querySelector(".expr-input");
  const deleteBtn = frag.querySelector(".delete-btn");
  const visibleInput = frag.querySelector(".visible-input");
  const previewValue = frag.querySelector(".preview-value");

  const row = {
    id,
    expr,
    visible: true,
    compileStatus: "pending",
    compiled: null,
    usesTime: false,
    rowEl,
    input,
    previewValue,
    visibleInput,
  };

  input.value = expr;
  compileRow(row);

  input.addEventListener("input", () => {
    row.expr = input.value;
    compileRow(row);
    updateStatus();
    scheduleRender();
  });

  visibleInput.addEventListener("change", () => {
    row.visible = visibleInput.checked;
    updateActiveTimeRows();
    updateStatus();
    scheduleRender();
  });

  deleteBtn.addEventListener("click", () => {
    state.rows = state.rows.filter((r) => r.id !== id);
    rowEl.remove();
    updateActiveTimeRows();
    updateStatus();
    if (TRAIL_ENABLED) clearTrail();
    scheduleRender();
  });

  state.rows.push(row);
  rowsEl.appendChild(frag);
  updateStatus();
  scheduleRender();
  input.focus();
  return row;
}

function createParam(name = "", valueExpr = "") {
  const id = state.nextParamId++;
  const frag = paramTemplate.content.cloneNode(true);
  const rowEl = frag.querySelector(".item-row");
  const nameInput = frag.querySelector(".param-name");
  const valueInput = frag.querySelector(".param-value");
  const deleteBtn = frag.querySelector(".delete-btn");
  const resultEl = frag.querySelector(".param-result");

  const param = {
    id,
    name,
    valueExpr,
    value: 0,
    status: "pending",
    compiled: null,
    normalized: "",
    rowEl,
    nameInput,
    valueInput,
    resultEl,
  };

  nameInput.value = name;
  valueInput.value = valueExpr;
  compileParam(param);

  let debounceTimer = 0;
  const handleChange = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      param.name = nameInput.value.trim();
      param.valueExpr = valueInput.value.trim();
      compileParam(param);
      refreshParameters();
    }, 0);
  };

  nameInput.addEventListener("input", handleChange);
  valueInput.addEventListener("input", handleChange);

  deleteBtn.addEventListener("click", () => {
    state.params = state.params.filter((p) => p.id !== id);
    rowEl.remove();
    refreshParameters();
  });

  state.params.push(param);
  paramsEl.appendChild(frag);
  refreshParameters();
  nameInput.focus();
  return param;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clearTrail();
  scheduleRender();
}

function worldToScreen(x, y) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.width / 2 + (x - state.view.x) * state.view.scale,
    y: rect.height / 2 - (y - state.view.y) * state.view.scale,
  };
}

function screenToWorld(px, py) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (px - rect.width / 2) / state.view.scale + state.view.x,
    y: -(py - rect.height / 2) / state.view.scale + state.view.y,
  };
}

function getStyles() {
  const root = getComputedStyle(document.documentElement);
  return {
    panel2: root.getPropertyValue("--panel-2").trim() || "#0e1115",
    grid: root.getPropertyValue("--grid").trim() || "rgba(255,255,255,0.05)",
    gridStrong:
      root.getPropertyValue("--grid-strong").trim() || "rgba(255,255,255,0.11)",
    axis: root.getPropertyValue("--axis").trim() || "rgba(255,59,59,0.9)",
    graph: root.getPropertyValue("--graph").trim() || "#ff2b2b",
    graphSoft:
      root.getPropertyValue("--graph-soft").trim() || "rgba(255,43,43,0.22)",
  };
}

function drawGrid(targetCtx) {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const scale = state.view.scale;
  const step = 1;
  const colors = getStyles();

  targetCtx.clearRect(0, 0, width, height);
  targetCtx.fillStyle = colors.panel2;
  targetCtx.fillRect(0, 0, width, height);

  const origin = worldToScreen(0, 0);
  const left = state.view.x - width / (2 * scale);
  const right = state.view.x + width / (2 * scale);
  const top = state.view.y + height / (2 * scale);
  const bottom = state.view.y - height / (2 * scale);

  const startX = Math.floor(left / step) * step;
  const endX = Math.ceil(right / step) * step;
  const startY = Math.floor(bottom / step) * step;
  const endY = Math.ceil(top / step) * step;

  targetCtx.lineWidth = 1;
  targetCtx.font = "12px Segoe UI, sans-serif";

  for (let x = startX; x <= endX; x += step) {
    const sx = worldToScreen(x, 0).x;
    targetCtx.beginPath();
    targetCtx.strokeStyle =
      Math.abs(x) < 1e-9
        ? colors.axis
        : x % 5 === 0
        ? colors.gridStrong
        : colors.grid;
    targetCtx.moveTo(sx, 0);
    targetCtx.lineTo(sx, height);
    targetCtx.stroke();

    if (Math.abs(x) > 1e-9) {
      targetCtx.fillStyle = "rgba(255,255,255,0.45)";
      targetCtx.fillText(formatNumber(x), sx + 3, origin.y - 4);
    }
  }

  for (let y = startY; y <= endY; y += step) {
    const sy = worldToScreen(0, y).y;
    targetCtx.beginPath();
    targetCtx.strokeStyle =
      Math.abs(y) < 1e-9
        ? colors.axis
        : y % 5 === 0
        ? colors.gridStrong
        : colors.grid;
    targetCtx.moveTo(0, sy);
    targetCtx.lineTo(width, sy);
    targetCtx.stroke();

    if (Math.abs(y) > 1e-9) {
      targetCtx.fillStyle = "rgba(255,255,255,0.45)";
      targetCtx.fillText(formatNumber(y), origin.x + 4, sy - 4);
    }
  }
}

function shouldBreakLine(prev, next, height) {
  return prev === null || next === null || Math.abs(next - prev) > height / 2;
}

function drawPathFromValues(targetCtx, values, minX, maxX, colors, height) {
  targetCtx.beginPath();
  let drawing = false;
  let lastY = null;

  for (let i = 0; i < values.length; i++) {
    const y = values[i];
    const x = minX + (i / (values.length - 1)) * (maxX - minX);

    if (y === null) {
      drawing = false;
      lastY = null;
      continue;
    }

    const sx = worldToScreen(x, 0).x;
    const sy = worldToScreen(0, y).y;

    if (!drawing || shouldBreakLine(lastY, y, height)) {
      targetCtx.moveTo(sx, sy);
      drawing = true;
    } else {
      targetCtx.lineTo(sx, sy);
    }

    lastY = y;
  }

  if (GRAPH_GLOW_ENABLED) {
    targetCtx.save();
    targetCtx.shadowBlur = GRAPH_GLOW_RADIUS;
    targetCtx.shadowColor = colors.graph;
    targetCtx.strokeStyle = colors.graphSoft;
    targetCtx.lineWidth = GRAPH_GLOW_STROKE_WIDTH;
    targetCtx.stroke();
    targetCtx.restore();
  }

  targetCtx.strokeStyle = colors.graph;
  targetCtx.lineWidth = TRAIL_ENABLED ? TRAIL_WIDTH : GRAPH_STROKE_WIDTH;
  targetCtx.stroke();
}

function drawFunctions(targetCtx) {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const colors = getStyles();

  const samples = Math.max(500, Math.min(1600, Math.floor(width * 1.05)));
  const minX = state.view.x - width / (2 * state.view.scale);
  const maxX = state.view.x + width / (2 * state.view.scale);
  const activeRows = state.rows.filter(
    (r) => r.visible && r.compileStatus === "ok" && r.compiled
  );

  if (!activeRows.length) return;

  if (state.combinedMode) {
    const values = new Array(samples + 1);
    for (let i = 0; i <= samples; i++) {
      const x = minX + (i / samples) * (maxX - minX);
      let sum = 0;
      let hasValue = false;
      for (const row of activeRows) {
        const y = evaluateWithScope(row.compiled, x, state.t);
        if (typeof y === "number" && Number.isFinite(y)) {
          sum += y;
          hasValue = true;
        }
      }
      values[i] = hasValue ? sum : null;
    }
    drawPathFromValues(targetCtx, values, minX, maxX, colors, height);
    return;
  }

  for (const row of activeRows) {
    const values = new Array(samples + 1);
    for (let i = 0; i <= samples; i++) {
      const x = minX + (i / samples) * (maxX - minX);
      const y = evaluateWithScope(row.compiled, x, state.t);
      values[i] = typeof y === "number" && Number.isFinite(y) ? y : null;
    }
    drawPathFromValues(targetCtx, values, minX, maxX, colors, height);
  }
}

function drawCursor(targetCtx) {
  if (!state.mouse.inside) return;
  const rect = canvas.getBoundingClientRect();
  targetCtx.save();
  targetCtx.setLineDash([6, 6]);
  targetCtx.strokeStyle = "rgba(255,255,255,0.12)";
  targetCtx.beginPath();
  targetCtx.moveTo(state.mouse.x, 0);
  targetCtx.lineTo(state.mouse.x, rect.height);
  targetCtx.moveTo(0, state.mouse.y);
  targetCtx.lineTo(rect.width, state.mouse.y);
  targetCtx.stroke();
  targetCtx.restore();
}

function updateLivePreviews() {
  for (const row of state.rows) {
    if (row.compileStatus === "ok" && row.usesTime) syncRowPreview(row);
  }
}

function render() {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  drawGrid(ctx);

  if (TRAIL_ENABLED) {
    const fade = Math.max(0.02, Math.min(0.35, TRAIL_FADE));
    trailCtx.save();
    trailCtx.globalCompositeOperation = "destination-out";
    trailCtx.fillStyle = `rgba(0, 0, 0, ${fade})`;
    trailCtx.fillRect(0, 0, width, height);
    trailCtx.restore();

    drawFunctions(trailCtx);
    ctx.drawImage(trailCanvas, 0, 0, width, height);
  } else {
    drawFunctions(ctx);
  }

  drawCursor(ctx);
  timeValueEl.textContent = formatCoord(state.t);
  updateLivePreviews();
  state.needsRender = false;
}

function frame(now) {
  state.renderQueued = false;

  if (!state.lastFrameTime) state.lastFrameTime = now;
  const elapsed = now - state.lastFrameTime;
  state.lastFrameTime = now;

  const stepMs = 1000 / FPS;
  let advanced = false;

  if (state.animateT && state.activeTimeRows > 0) {
    state.tAccumulator += elapsed;
    while (state.tAccumulator >= stepMs) {
      state.t = (state.t + stepMs / 1000) % TIME_WRAP_SECONDS;
      state.tAccumulator -= stepMs;
      advanced = true;
    }
  } else {
    state.tAccumulator = 0;
  }

  if (advanced) state.needsRender = true;
  if (state.needsRender) render();

  if ((state.animateT && state.activeTimeRows > 0) || state.needsRender) {
    scheduleRender();
  }
}

function setControlLabels() {
  toggleAnimateBtn.textContent = state.animateT ? "Pause t" : "Play t";
  toggleAnimateBtn.setAttribute("aria-pressed", String(state.animateT));
  toggleModeBtn.textContent = state.combinedMode
    ? "Combined: on"
    : "Combined: off";
  toggleModeBtn.setAttribute("aria-pressed", String(state.combinedMode));
}

function bindEvents() {
  addRowBtn.addEventListener("click", () => createRow(""));
  addParamBtn.addEventListener("click", () => createParam("", ""));

  toggleAnimateBtn.addEventListener("click", () => {
    state.animateT = !state.animateT;
    setControlLabels();
    state.lastFrameTime = 0;
    scheduleRender();
  });

  resetTimeBtn.addEventListener("click", () => {
    state.t = 0;
    state.tAccumulator = 0;
    scheduleRender();
  });

  toggleModeBtn.addEventListener("click", () => {
    state.combinedMode = !state.combinedMode;
    setControlLabels();
    if (TRAIL_ENABLED) clearTrail();
    scheduleRender();
  });

  resetViewBtn.addEventListener("click", () => {
    state.view.x = 0;
    state.view.y = 0;
    state.view.scale = 60;
    if (TRAIL_ENABLED) clearTrail();
    scheduleRender();
  });

  window.addEventListener("resize", resizeCanvas);

  let dragging = false;
  let dragStart = null;

  canvas.addEventListener("mousedown", (e) => {
    dragging = true;
    dragStart = {
      x: e.clientX,
      y: e.clientY,
      vx: state.view.x,
      vy: state.view.y,
    };
    canvas.classList.add("dragging");
  });

  window.addEventListener("mouseup", () => {
    dragging = false;
    dragStart = null;
    canvas.classList.remove("dragging");
  });

  window.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    state.mouse.x = px;
    state.mouse.y = py;
    state.mouse.inside =
      px >= 0 && py >= 0 && px <= rect.width && py <= rect.height;

    const world = screenToWorld(px, py);
    mouseXEl.textContent = formatCoord(world.x);
    mouseYEl.textContent = formatCoord(world.y);

    if (dragging && dragStart) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      state.view.x = dragStart.vx - dx / state.view.scale;
      state.view.y = dragStart.vy + dy / state.view.scale;
      if (TRAIL_ENABLED) clearTrail();
      scheduleRender();
      return;
    }

    if (state.mouse.inside) scheduleRender();
  });

  canvas.addEventListener("mouseleave", () => {
    state.mouse.inside = false;
    scheduleRender();
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const before = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const zoom = Math.exp(-e.deltaY * 0.00125);
      state.view.scale = Math.min(240, Math.max(18, state.view.scale * zoom));
      const after = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      state.view.x += before.x - after.x;
      state.view.y += before.y - after.y;
      if (TRAIL_ENABLED) clearTrail();
      scheduleRender();
    },
    { passive: false }
  );
}

function init() {
  setControlLabels();
  bindEvents();
  resizeCanvas();
  updateStatus();
  render();
}

init();
