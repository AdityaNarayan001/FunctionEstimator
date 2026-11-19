import { examples, parsePointText, validatePoints } from "./symbolic-core.js";

const tableBody = document.querySelector("#pointTable");
const pasteInput = document.querySelector("#pasteInput");
const dataMessage = document.querySelector("#dataMessage");
const runStatus = document.querySelector("#runStatus");
const runButton = document.querySelector("#runButton");
const stopButton = document.querySelector("#stopButton");
const addRowButton = document.querySelector("#addRowButton");
const clearButton = document.querySelector("#clearButton");
const pasteButton = document.querySelector("#pasteButton");
const copyButton = document.querySelector("#copyButton");
const formulaOutput = document.querySelector("#formulaOutput");
const mseMetric = document.querySelector("#mseMetric");
const nodeMetric = document.querySelector("#nodeMetric");
const lossMetric = document.querySelector("#lossMetric");
const generationMetric = document.querySelector("#generationMetric");
const progressFill = document.querySelector("#progressFill");
const candidateList = document.querySelector("#candidateList");
const plotCanvas = document.querySelector("#plotCanvas");
const plotContext = plotCanvas.getContext("2d");

const inputs = {
  populationSize: document.querySelector("#populationInput"),
  generations: document.querySelector("#generationsInput"),
  mutationRate: document.querySelector("#mutationInput"),
  complexityAllowance: document.querySelector("#complexityInput"),
  smoothnessWeight: document.querySelector("#smoothnessInput"),
  seed: document.querySelector("#seedInput")
};

let currentWorker = null;
let lastResult = null;
let currentPoints = [];

loadExample("quadratic");
drawEmptyPlot();

document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => loadExample(button.dataset.example));
});

addRowButton.addEventListener("click", () => {
  currentPoints.push({ x: "", y: "" });
  renderTable();
});

clearButton.addEventListener("click", () => {
  currentPoints = [];
  renderTable();
  setDataMessage("Cleared.");
  resetResult();
});

pasteButton.addEventListener("click", () => {
  const parsed = parsePointText(pasteInput.value);
  if (parsed.errors.length > 0) {
    setDataMessage(parsed.errors.join(" "));
  }
  if (parsed.points.length > 0) {
    currentPoints = parsed.points;
    renderTable();
    setDataMessage(`Imported ${parsed.points.length} points.`);
    resetResult();
  }
});

runButton.addEventListener("click", runSearch);
stopButton.addEventListener("click", stopSearch);
copyButton.addEventListener("click", async () => {
  if (!lastResult?.formula) {
    return;
  }

  try {
    await navigator.clipboard.writeText(lastResult.formula);
    runStatus.textContent = "Formula copied.";
  } catch {
    runStatus.textContent = "Copy failed.";
  }
});

function loadExample(name) {
  currentPoints = (examples[name] ?? examples.quadratic).map((point) => ({ ...point }));
  pasteInput.value = currentPoints.map((point) => `${point.x}, ${point.y}`).join("\n");
  renderTable();
  setDataMessage(`${currentPoints.length} example points loaded.`);
  resetResult();
}

function renderTable() {
  tableBody.replaceChildren();

  currentPoints.forEach((point, index) => {
    const row = document.createElement("tr");
    const xCell = document.createElement("td");
    const yCell = document.createElement("td");
    const actionCell = document.createElement("td");

    const xInput = document.createElement("input");
    xInput.type = "number";
    xInput.step = "any";
    xInput.value = point.x;
    xInput.setAttribute("aria-label", `x value row ${index + 1}`);
    xInput.addEventListener("input", () => {
      currentPoints[index].x = xInput.value;
    });

    const yInput = document.createElement("input");
    yInput.type = "number";
    yInput.step = "any";
    yInput.value = point.y;
    yInput.setAttribute("aria-label", `y value row ${index + 1}`);
    yInput.addEventListener("input", () => {
      currentPoints[index].y = yInput.value;
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "secondary";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      currentPoints.splice(index, 1);
      renderTable();
    });

    xCell.append(xInput);
    yCell.append(yInput);
    actionCell.append(removeButton);
    row.append(xCell, yCell, actionCell);
    tableBody.append(row);
  });
}

function collectPoints() {
  return currentPoints
    .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
    .filter((point) => Number.isFinite(point.x) || Number.isFinite(point.y));
}

function collectConfig() {
  return {
    populationSize: Number(inputs.populationSize.value),
    generations: Number(inputs.generations.value),
    mutationRate: Number(inputs.mutationRate.value),
    complexityAllowance: Number(inputs.complexityAllowance.value),
    smoothnessWeight: Number(inputs.smoothnessWeight.value),
    seed: inputs.seed.value || "function-estimator"
  };
}

function runSearch() {
  const points = collectPoints();
  const errors = validatePoints(points);
  if (errors.length > 0) {
    setDataMessage(errors.join(" "));
    return;
  }

  stopSearch(false);
  lastResult = null;
  runButton.disabled = true;
  stopButton.disabled = false;
  copyButton.disabled = true;
  progressFill.style.width = "0%";
  runStatus.textContent = "Starting...";
  setDataMessage(`${points.length} training points.`);

  try {
    currentWorker = new Worker("./src/worker.js", { type: "module" });
  } catch {
    runStatus.textContent = "Worker unavailable. Run through a local server.";
    runButton.disabled = false;
    stopButton.disabled = true;
    return;
  }

  currentWorker.addEventListener("message", handleWorkerMessage);
  currentWorker.addEventListener("error", (event) => {
    runStatus.textContent = event.message || "Worker failed.";
    finishRun();
  });
  currentWorker.postMessage({ type: "start", points, config: collectConfig() });
}

function stopSearch(updateStatus = true) {
  if (!currentWorker) {
    return;
  }

  currentWorker.postMessage({ type: "stop" });
  currentWorker.terminate();
  currentWorker = null;
  finishRun();
  if (updateStatus) {
    runStatus.textContent = "Stopped.";
  }
}

function handleWorkerMessage(event) {
  const message = event.data;
  if (message.type === "error") {
    runStatus.textContent = message.errors?.join(" ") || "Search failed.";
    finishRun();
    return;
  }

  if (message.result) {
    updateResult(message.result);
  }

  if (message.type === "done") {
    runStatus.textContent = "Done.";
    progressFill.style.width = "100%";
    finishRun();
  } else if (message.type === "stopped") {
    runStatus.textContent = "Stopped.";
    finishRun();
  } else if (message.type === "progress") {
    const generations = Number(inputs.generations.value) || 1;
    const progress = Math.min(100, (message.result.generation / generations) * 100);
    progressFill.style.width = `${progress}%`;
    runStatus.textContent = `Generation ${message.result.generation}`;
  }
}

function finishRun() {
  if (currentWorker) {
    currentWorker.terminate();
    currentWorker = null;
  }
  runButton.disabled = false;
  stopButton.disabled = true;
  copyButton.disabled = !lastResult?.formula;
}

function updateResult(result) {
  lastResult = result;
  formulaOutput.textContent = result.formula;
  mseMetric.textContent = formatMetric(result.mse);
  nodeMetric.textContent = String(result.nodeCount);
  lossMetric.textContent = formatMetric(result.loss);
  generationMetric.textContent = String(result.generation);
  renderCandidates(result.candidates ?? []);
  drawPlot(result.predictions ?? [], result.curve ?? []);
}

function resetResult() {
  lastResult = null;
  formulaOutput.textContent = "Run the search to estimate a function.";
  mseMetric.textContent = "-";
  nodeMetric.textContent = "-";
  lossMetric.textContent = "-";
  generationMetric.textContent = "-";
  progressFill.style.width = "0%";
  candidateList.replaceChildren();
  copyButton.disabled = true;
  drawEmptyPlot();
}

function renderCandidates(candidates) {
  candidateList.replaceChildren();
  if (candidates.length === 0) {
    return;
  }

  candidates.forEach((candidate) => {
    const item = document.createElement("li");
    const formula = document.createElement("code");
    const meta = document.createElement("span");
    formula.textContent = candidate.formula;
    meta.textContent = `MSE ${formatMetric(candidate.mse)} | loss ${formatMetric(candidate.loss)} | ${candidate.nodeCount} nodes`;
    item.append(formula, meta);
    candidateList.append(item);
  });
}

function drawEmptyPlot() {
  const width = plotCanvas.width;
  const height = plotCanvas.height;
  plotContext.clearRect(0, 0, width, height);
  plotContext.fillStyle = "#fffdf8";
  plotContext.fillRect(0, 0, width, height);
  plotContext.strokeStyle = "#d8d1c4";
  plotContext.lineWidth = 1;
  for (let index = 0; index <= 8; index += 1) {
    const x = 44 + ((width - 80) * index) / 8;
    plotContext.beginPath();
    plotContext.moveTo(x, 24);
    plotContext.lineTo(x, height - 42);
    plotContext.stroke();
  }
  for (let index = 0; index <= 5; index += 1) {
    const y = 24 + ((height - 66) * index) / 5;
    plotContext.beginPath();
    plotContext.moveTo(44, y);
    plotContext.lineTo(width - 36, y);
    plotContext.stroke();
  }
  plotContext.fillStyle = "#64706d";
  plotContext.font = "16px system-ui, sans-serif";
  plotContext.fillText("Run the search to draw a prediction curve.", 54, 58);
}

function drawPlot(predictions, curve) {
  if (predictions.length === 0 && curve.length === 0) {
    drawEmptyPlot();
    return;
  }

  const width = plotCanvas.width;
  const height = plotCanvas.height;
  const padding = { left: 54, right: 34, top: 28, bottom: 48 };
  const allPoints = [
    ...predictions.map((point) => ({ x: point.x, y: point.y })),
    ...predictions.map((point) => ({ x: point.x, y: point.predicted })),
    ...curve
  ].filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  let minX = Math.min(...allPoints.map((point) => point.x));
  let maxX = Math.max(...allPoints.map((point) => point.x));
  let minY = Math.min(...allPoints.map((point) => point.y));
  let maxY = Math.max(...allPoints.map((point) => point.y));

  if (Math.abs(maxX - minX) < 0.000001) {
    minX -= 1;
    maxX += 1;
  }
  if (Math.abs(maxY - minY) < 0.000001) {
    minY -= 1;
    maxY += 1;
  }

  const yPadding = (maxY - minY) * 0.12;
  minY -= yPadding;
  maxY += yPadding;

  const toCanvasX = (x) => padding.left + ((x - minX) / (maxX - minX)) * (width - padding.left - padding.right);
  const toCanvasY = (y) => height - padding.bottom - ((y - minY) / (maxY - minY)) * (height - padding.top - padding.bottom);

  plotContext.clearRect(0, 0, width, height);
  plotContext.fillStyle = "#fffdf8";
  plotContext.fillRect(0, 0, width, height);
  drawGrid(width, height, padding, minX, maxX, minY, maxY, toCanvasX, toCanvasY);

  if (curve.length > 1) {
    plotContext.beginPath();
    curve.forEach((point, index) => {
      const x = toCanvasX(point.x);
      const y = toCanvasY(point.y);
      if (index === 0) {
        plotContext.moveTo(x, y);
      } else {
        plotContext.lineTo(x, y);
      }
    });
    plotContext.strokeStyle = "#0b6f68";
    plotContext.lineWidth = 3;
    plotContext.stroke();
  }

  predictions.forEach((point) => {
    plotContext.beginPath();
    plotContext.arc(toCanvasX(point.x), toCanvasY(point.predicted), 4.2, 0, Math.PI * 2);
    plotContext.fillStyle = "#d99027";
    plotContext.fill();
  });

  predictions.forEach((point) => {
    plotContext.beginPath();
    plotContext.arc(toCanvasX(point.x), toCanvasY(point.y), 5.6, 0, Math.PI * 2);
    plotContext.fillStyle = "#c7533f";
    plotContext.fill();
    plotContext.strokeStyle = "#ffffff";
    plotContext.lineWidth = 2;
    plotContext.stroke();
  });

  drawLegend(width);
}

function drawGrid(width, height, padding, minX, maxX, minY, maxY, toCanvasX, toCanvasY) {
  plotContext.strokeStyle = "#e2dbd0";
  plotContext.lineWidth = 1;
  plotContext.fillStyle = "#64706d";
  plotContext.font = "12px system-ui, sans-serif";

  for (let index = 0; index <= 6; index += 1) {
    const xValue = minX + ((maxX - minX) * index) / 6;
    const x = toCanvasX(xValue);
    plotContext.beginPath();
    plotContext.moveTo(x, padding.top);
    plotContext.lineTo(x, height - padding.bottom);
    plotContext.stroke();
    plotContext.fillText(formatAxis(xValue), x - 12, height - 22);
  }

  for (let index = 0; index <= 5; index += 1) {
    const yValue = minY + ((maxY - minY) * index) / 5;
    const y = toCanvasY(yValue);
    plotContext.beginPath();
    plotContext.moveTo(padding.left, y);
    plotContext.lineTo(width - padding.right, y);
    plotContext.stroke();
    plotContext.fillText(formatAxis(yValue), 8, y + 4);
  }
}

function drawLegend(width) {
  const y = 24;
  plotContext.fillStyle = "#c7533f";
  plotContext.beginPath();
  plotContext.arc(width - 210, y, 5, 0, Math.PI * 2);
  plotContext.fill();
  plotContext.fillStyle = "#64706d";
  plotContext.font = "13px system-ui, sans-serif";
  plotContext.fillText("Training data", width - 198, y + 4);

  plotContext.fillStyle = "#0b6f68";
  plotContext.fillRect(width - 90, y - 2, 20, 4);
  plotContext.fillStyle = "#64706d";
  plotContext.fillText("Estimate", width - 64, y + 4);
}

function formatMetric(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.001) {
    return value.toExponential(3);
  }
  return String(Math.round(value * 10000) / 10000);
}

function formatAxis(value) {
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) {
    return value.toExponential(1);
  }
  return String(Math.round(value * 100) / 100);
}

function setDataMessage(message) {
  dataMessage.textContent = message;
}
