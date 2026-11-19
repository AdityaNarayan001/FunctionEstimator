export const EPSILON = 1e-6;
export const SAFE_LIMIT = 1e6;

const UNARY_OPS = ["neg", "square", "sin", "cos", "exp", "log", "sqrt"];
const BINARY_OPS = ["add", "sub", "mul", "div"];

export function createRng(seedValue = "function-estimator") {
  let state = hashSeed(seedValue);
  return function rng() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(value) {
  const text = String(value ?? "function-estimator");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 0x9e3779b9;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(parsed, min, max);
}

function randomBetween(rng, min, max) {
  return min + (max - min) * rng();
}

function choose(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

function rounded(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function constNode(value) {
  const safeValue = Number.isFinite(value) ? clamp(value, -1000, 1000) : 0;
  return { type: "const", value: rounded(safeValue, 5) };
}

export function varNode() {
  return { type: "var" };
}

export function unaryNode(op, child) {
  return { type: "unary", op, child };
}

export function binaryNode(op, left, right) {
  return { type: "binary", op, left, right };
}

export function cloneNode(node) {
  if (node.type === "const") {
    return constNode(node.value);
  }
  if (node.type === "var") {
    return varNode();
  }
  if (node.type === "unary") {
    return unaryNode(node.op, cloneNode(node.child));
  }
  return binaryNode(node.op, cloneNode(node.left), cloneNode(node.right));
}

export function randomTree(rng, maxDepth = 4) {
  if (maxDepth <= 0 || rng() < 0.28) {
    return randomTerminal(rng);
  }

  if (rng() < 0.45) {
    return unaryNode(choose(rng, UNARY_OPS), randomTree(rng, maxDepth - 1));
  }

  return binaryNode(
    choose(rng, BINARY_OPS),
    randomTree(rng, maxDepth - 1),
    randomTree(rng, maxDepth - 1)
  );
}

// A random tree that respects the size cap: shallower trees are tried until
// one fits (a depth-0 tree is a single node, so this always ends).
function boundedRandomTree(rng, maxDepth, maxNodes) {
  for (let depth = maxDepth; depth > 0; depth -= 1) {
    const tree = randomTree(rng, depth);
    if (nodeCount(tree) <= maxNodes) {
      return tree;
    }
  }
  return randomTerminal(rng);
}

function randomTerminal(rng) {
  if (rng() < 0.48) {
    return varNode();
  }

  if (rng() < 0.55) {
    return constNode(choose(rng, [-5, -3, -2, -1, -0.5, 0, 0.5, 1, 2, 3, 5]));
  }

  return constNode(rounded(randomBetween(rng, -5, 5), 3));
}

export function nodeCount(node) {
  if (node.type === "const" || node.type === "var") {
    return 1;
  }
  if (node.type === "unary") {
    return 1 + nodeCount(node.child);
  }
  return 1 + nodeCount(node.left) + nodeCount(node.right);
}

export function hasVariable(node) {
  if (node.type === "var") {
    return true;
  }
  if (node.type === "const") {
    return false;
  }
  if (node.type === "unary") {
    return hasVariable(node.child);
  }
  return hasVariable(node.left) || hasVariable(node.right);
}

export function evaluateNode(node, x) {
  return evaluateDetailed(node, x).value;
}

export function evaluateDetailed(node, x) {
  try {
    if (node.type === "const") {
      return finiteResult(node.value);
    }
    if (node.type === "var") {
      return finiteResult(x);
    }
    if (node.type === "unary") {
      const child = evaluateDetailed(node.child, x);
      return applyUnary(node.op, child.value, child.penalty);
    }
    if (node.type === "binary") {
      const left = evaluateDetailed(node.left, x);
      const right = evaluateDetailed(node.right, x);
      return applyBinary(node.op, left.value, right.value, left.penalty + right.penalty);
    }
  } catch {
    return { value: 0, penalty: 100000 };
  }

  return { value: 0, penalty: 100000 };
}

function finiteResult(value, penalty = 0) {
  if (!Number.isFinite(value)) {
    return { value: 0, penalty: penalty + 100000 };
  }

  if (Math.abs(value) > SAFE_LIMIT) {
    const sign = Math.sign(value) || 1;
    const excess = Math.log10(Math.abs(value) / SAFE_LIMIT + 1);
    return { value: sign * SAFE_LIMIT, penalty: penalty + 50 * excess };
  }

  return { value, penalty };
}

function applyUnary(op, value, inheritedPenalty) {
  if (op === "neg") {
    return finiteResult(-value, inheritedPenalty);
  }
  if (op === "square") {
    return finiteResult(value * value, inheritedPenalty);
  }
  if (op === "sin") {
    return finiteResult(Math.sin(value), inheritedPenalty);
  }
  if (op === "cos") {
    return finiteResult(Math.cos(value), inheritedPenalty);
  }
  if (op === "exp") {
    const clampedInput = clamp(value, -12, 12);
    const penalty = inheritedPenalty + Math.abs(value - clampedInput) * 0.02;
    return finiteResult(Math.exp(clampedInput), penalty);
  }
  if (op === "log") {
    return finiteResult(Math.log(Math.abs(value) + EPSILON), inheritedPenalty);
  }
  if (op === "sqrt") {
    return finiteResult(Math.sqrt(Math.abs(value)), inheritedPenalty);
  }
  return finiteResult(value, inheritedPenalty + 1000);
}

function applyBinary(op, left, right, inheritedPenalty) {
  if (op === "add") {
    return finiteResult(left + right, inheritedPenalty);
  }
  if (op === "sub") {
    return finiteResult(left - right, inheritedPenalty);
  }
  if (op === "mul") {
    return finiteResult(left * right, inheritedPenalty);
  }
  if (op === "div") {
    const sign = right < 0 ? -1 : 1;
    const denominator = Math.abs(right) < EPSILON ? sign * EPSILON : right;
    const penalty = inheritedPenalty + (Math.abs(right) < EPSILON ? 0.15 : 0);
    return finiteResult(left / denominator, penalty);
  }
  return finiteResult(left, inheritedPenalty + 1000);
}

export function simplifyConstants(node) {
  if (node.type === "const" || node.type === "var") {
    return cloneNode(node);
  }

  if (node.type === "unary") {
    const child = simplifyConstants(node.child);
    const simplified = unaryNode(node.op, child);
    if (!hasVariable(simplified)) {
      return constNode(evaluateNode(simplified, 0));
    }
    return simplified;
  }

  const left = simplifyConstants(node.left);
  const right = simplifyConstants(node.right);
  const simplified = binaryNode(node.op, left, right);
  if (!hasVariable(simplified)) {
    return constNode(evaluateNode(simplified, 0));
  }
  return simplified;
}

export function nodesEqual(a, b) {
  if (a.type !== b.type) {
    return false;
  }
  if (a.type === "const") {
    return a.value === b.value;
  }
  if (a.type === "var") {
    return true;
  }
  if (a.type === "unary") {
    return a.op === b.op && nodesEqual(a.child, b.child);
  }
  return a.op === b.op && nodesEqual(a.left, b.left) && nodesEqual(a.right, b.right);
}

// Constant folding plus the algebraic identities that never change the value:
// a + 0, a - 0, 0 - a, a - a, a * 1, a * 0, a / 1, 0 / a and -(-a).
export function simplifyTree(node) {
  if (node.type === "const" || node.type === "var") {
    return cloneNode(node);
  }

  if (node.type === "unary") {
    const child = simplifyTree(node.child);
    if (child.type === "const") {
      return constNode(evaluateNode(unaryNode(node.op, child), 0));
    }
    if (node.op === "neg" && child.type === "unary" && child.op === "neg") {
      return child.child;
    }
    return unaryNode(node.op, child);
  }

  const left = simplifyTree(node.left);
  const right = simplifyTree(node.right);
  const isConst = (candidate, value) => candidate.type === "const" && candidate.value === value;

  if (left.type === "const" && right.type === "const") {
    return constNode(evaluateNode(binaryNode(node.op, left, right), 0));
  }

  if (node.op === "add") {
    if (isConst(left, 0)) return right;
    if (isConst(right, 0)) return left;
  } else if (node.op === "sub") {
    if (isConst(right, 0)) return left;
    if (isConst(left, 0)) return unaryNode("neg", right);
    if (nodesEqual(left, right)) return constNode(0);
  } else if (node.op === "mul") {
    if (isConst(left, 0) || isConst(right, 0)) return constNode(0);
    if (isConst(left, 1)) return right;
    if (isConst(right, 1)) return left;
  } else if (node.op === "div") {
    if (isConst(right, 1)) return left;
    if (isConst(left, 0)) return constNode(0);
  }

  return binaryNode(node.op, left, right);
}

// Subtree crossover: a random subtree of the first parent is replaced by a
// random subtree of the second.
export function crossoverTrees(first, second, rng) {
  const target = choose(rng, collectPaths(first));
  const donor = getNodeAt(second, choose(rng, collectPaths(second)));
  return replaceAt(first, target, donor);
}

export function mutateTree(node, rng, options = {}) {
  const maxDepth = options.maxDepth ?? 4;
  const root = cloneNode(node);
  const paths = collectPaths(root);
  const constPaths = paths.filter((path) => getNodeAt(root, path).type === "const");
  const deletablePaths = paths.filter((path) => {
    const target = getNodeAt(root, path);
    return target.type === "unary" || target.type === "binary";
  });
  const constantSubtreePaths = paths.filter((path) => {
    const target = getNodeAt(root, path);
    return target.type !== "var" && !hasVariable(target);
  });

  const actions = ["replace"];
  if (constPaths.length > 0) {
    actions.push("tweak");
  }
  if (deletablePaths.length > 0) {
    actions.push("delete");
  }
  if (constantSubtreePaths.length > 0) {
    actions.push("simplify");
  }

  const action = choose(rng, actions);

  if (action === "tweak") {
    const path = choose(rng, constPaths);
    const target = getNodeAt(root, path);
    const scale = 0.15 + Math.abs(target.value) * 0.35;
    const replacement = constNode(target.value + randomBetween(rng, -scale, scale));
    return replaceAt(root, path, replacement);
  }

  if (action === "delete") {
    const path = choose(rng, deletablePaths);
    const target = getNodeAt(root, path);
    if (target.type === "unary") {
      return replaceAt(root, path, cloneNode(target.child));
    }
    return replaceAt(root, path, cloneNode(rng() < 0.5 ? target.left : target.right));
  }

  if (action === "simplify") {
    const path = choose(rng, constantSubtreePaths);
    const target = getNodeAt(root, path);
    return replaceAt(root, path, constNode(evaluateNode(target, 0)));
  }

  const path = choose(rng, paths);
  const depth = Math.max(1, Math.floor(randomBetween(rng, 1, maxDepth + 1)));
  return replaceAt(root, path, randomTree(rng, depth));
}

function collectPaths(node, basePath = []) {
  const paths = [basePath];
  if (node.type === "unary") {
    paths.push(...collectPaths(node.child, [...basePath, "child"]));
  } else if (node.type === "binary") {
    paths.push(...collectPaths(node.left, [...basePath, "left"]));
    paths.push(...collectPaths(node.right, [...basePath, "right"]));
  }
  return paths;
}

function getNodeAt(node, path) {
  return path.reduce((current, segment) => current[segment], node);
}

function replaceAt(node, path, replacement) {
  if (path.length === 0) {
    return cloneNode(replacement);
  }

  const [segment, ...rest] = path;
  const copy = cloneNode(node);
  copy[segment] = replaceAt(copy[segment], rest, replacement);
  return copy;
}

export function toFormula(node) {
  return formatNode(node, 0);
}

// Precedence levels: 2 add/sub, 3 mul/div, 4 unary minus, 5 power.
// Anything that prints with a leading minus is parenthesized wherever the
// minus could be misread: under a power, after another minus, or as the
// right operand of a binary operator.
function formatNode(node, parentPrecedence) {
  if (node.type === "const") {
    const text = formatNumber(node.value);
    return text.startsWith("-") && parentPrecedence > 3 ? `(${text})` : text;
  }
  if (node.type === "var") {
    return "x";
  }
  if (node.type === "unary") {
    if (node.op === "neg") {
      const text = `-${formatNode(node.child, 4)}`;
      return parentPrecedence >= 4 ? `(${text})` : text;
    }
    if (node.op === "square") {
      const text = `${formatNode(node.child, 5)}^2`;
      return parentPrecedence >= 5 ? `(${text})` : text;
    }
    // log and sqrt are evaluated on the absolute value of their input, so the
    // printed formula says so unless the input can never be negative.
    const inner = formatNode(node.child, 0);
    if ((node.op === "log" || node.op === "sqrt") && !isNonNegative(node.child)) {
      return `${node.op}(abs(${inner}))`;
    }
    return `${node.op}(${inner})`;
  }

  const precedence = node.op === "mul" || node.op === "div" ? 3 : 2;
  const symbol = { add: "+", sub: "-", mul: "*", div: "/" }[node.op] ?? "?";
  let rightPrecedence = node.op === "sub" || node.op === "div" ? precedence + 0.1 : precedence;
  if (printsLeadingMinus(node.right)) {
    rightPrecedence = 4;
  }
  const text = `${formatNode(node.left, precedence)} ${symbol} ${formatNode(node.right, rightPrecedence)}`;
  return precedence < parentPrecedence ? `(${text})` : text;
}

function isNonNegative(node) {
  if (node.type === "const") {
    return node.value >= 0;
  }
  if (node.type === "var") {
    return false;
  }
  if (node.type === "unary") {
    return node.op === "square" || node.op === "sqrt" || node.op === "exp";
  }
  if (node.op === "add" || node.op === "mul" || node.op === "div") {
    return isNonNegative(node.left) && isNonNegative(node.right);
  }
  return false;
}

function printsLeadingMinus(node) {
  if (node.type === "const") {
    return formatNumber(node.value).startsWith("-");
  }
  return node.type === "unary" && node.op === "neg";
}

function formatNumber(value) {
  if (Math.abs(value) < 0.000001) {
    return "0";
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(rounded(value, 5)).replace(/\.?0+$/, "");
}

export function parsePointText(text) {
  const points = [];
  const errors = [];
  const lines = String(text ?? "").split(/\r?\n/);

  let sawContent = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const isFirstContentLine = !sawContent;
    sawContent = true;

    const parts = trimmed.split(/[\s,;\t]+/).filter(Boolean);
    if (parts.length < 2) {
      errors.push(`Line ${index + 1}: expected x and y`);
      return;
    }

    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const looksLikeHeader = isFirstContentLine && /[a-z]/i.test(trimmed);
      if (!looksLikeHeader) {
        errors.push(`Line ${index + 1}: values must be finite numbers`);
      }
      return;
    }

    points.push({ x, y });
  });

  return { points, errors };
}

// Turns raw table rows (strings from inputs) into numeric points. Fully blank
// rows are dropped; a row with only one value filled keeps a NaN so that
// validatePoints reports it instead of silently training on 0.
export function rowsToPoints(rows) {
  const isBlank = (value) => String(value ?? "").trim() === "";
  const toNumber = (value) => (isBlank(value) ? Number.NaN : Number(value));
  return rows
    .filter((row) => !(isBlank(row.x) && isBlank(row.y)))
    .map((row) => ({ x: toNumber(row.x), y: toNumber(row.y) }));
}

export function validatePoints(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return ["Enter at least two valid points."];
  }

  const errors = [];
  points.forEach((point, index) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      errors.push(`Row ${index + 1} must contain finite numbers.`);
    }
  });

  return errors;
}

export function scoreExpression(node, points, config = {}) {
  const validPoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (validPoints.length === 0) {
    return infiniteScore();
  }

  const yValues = validPoints.map((point) => point.y);
  const yMean = yValues.reduce((sum, value) => sum + value, 0) / yValues.length;
  const variance = yValues.reduce((sum, value) => sum + (value - yMean) ** 2, 0) / yValues.length;
  const yScale = Math.max(Math.sqrt(variance), rangeOf(yValues) / 2, 1);

  let squaredError = 0;
  let normalizedError = 0;
  let penalty = 0;
  const predictions = [];

  for (const point of validPoints) {
    const result = evaluateDetailed(node, point.x);
    const prediction = result.value;
    const error = prediction - point.y;
    squaredError += error * error;
    normalizedError += (error / yScale) ** 2;
    penalty += result.penalty;
    predictions.push({ x: point.x, y: point.y, predicted: prediction });
  }

  const mse = squaredError / validPoints.length;
  const complexity = nodeCount(node);
  const allowance = Math.max(1, Number(config.complexityAllowance) || 6);
  const complexityPenalty = (complexity / allowance) * 0.018;
  const smoothness = estimateSmoothness(node, validPoints);
  const smoothnessWeight = Math.max(0, Number(config.smoothnessWeight) || 0);
  const totalLoss =
    normalizedError / validPoints.length +
    complexityPenalty +
    smoothnessWeight * smoothness +
    penalty / validPoints.length;

  return {
    loss: totalLoss,
    mse,
    normalizedError: normalizedError / validPoints.length,
    complexityPenalty,
    smoothness,
    penalty: penalty / validPoints.length,
    nodeCount: complexity,
    predictions
  };
}

function infiniteScore() {
  return {
    loss: Number.POSITIVE_INFINITY,
    mse: Number.POSITIVE_INFINITY,
    normalizedError: Number.POSITIVE_INFINITY,
    complexityPenalty: Number.POSITIVE_INFINITY,
    smoothness: Number.POSITIVE_INFINITY,
    penalty: Number.POSITIVE_INFINITY,
    nodeCount: 0,
    predictions: []
  };
}

function rangeOf(values) {
  if (values.length === 0) {
    return 0;
  }
  return Math.max(...values) - Math.min(...values);
}

function estimateSmoothness(node, points) {
  if (points.length < 2) {
    return 0;
  }

  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  let minX = Math.min(...xValues);
  let maxX = Math.max(...xValues);
  if (Math.abs(maxX - minX) < EPSILON) {
    minX -= 1;
    maxX += 1;
  }

  const sampleCount = 32;
  const step = (maxX - minX) / (sampleCount - 1);
  const yScale = Math.max(rangeOf(yValues), 1);
  const values = [];
  let penalty = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const x = minX + step * index;
    const result = evaluateDetailed(node, x);
    values.push(result.value);
    penalty += result.penalty;
  }

  let roughness = 0;
  for (let index = 1; index < values.length - 1; index += 1) {
    roughness += Math.abs(values[index + 1] - 2 * values[index] + values[index - 1]) / yScale;
  }

  let slopePenalty = 0;
  for (let index = 1; index < values.length; index += 1) {
    const slope = Math.abs((values[index] - values[index - 1]) / step);
    const scaledSlope = slope * Math.max(maxX - minX, 1) / yScale;
    slopePenalty += Math.max(0, scaledSlope - 60) / 60;
  }

  return clamp((roughness + slopePenalty) / sampleCount + penalty / sampleCount, 0, 100000);
}

export function evolve(points, config = {}, onProgress = () => {}, shouldStop = () => false) {
  const runConfig = normalizeConfig(config);
  const rng = createRng(runConfig.seed);
  let population = seedPopulation(points, runConfig, rng);

  while (population.length < runConfig.populationSize) {
    population.push(boundedRandomTree(rng, runConfig.initialDepth, runConfig.maxNodes));
  }

  let lastResult = null;

  for (let generation = 0; generation <= runConfig.generations; generation += 1) {
    const scored = population
      .map((node) => ({ node, score: scoreExpression(node, points, runConfig) }))
      .sort((a, b) => a.score.loss - b.score.loss);

    const finished = generation === runConfig.generations || shouldStop();
    const reporting = generation === 0 || generation % runConfig.progressEvery === 0;

    // Building a result samples the plot curve, so only do it when it is used.
    if (finished || reporting) {
      lastResult = buildFitResult(scored, points, generation, runConfig);
      onProgress(lastResult);
    }

    if (finished) {
      return lastResult;
    }

    population = nextGeneration(scored, runConfig, rng);
  }

  return lastResult;
}

function normalizeConfig(config) {
  const populationSize = clampInt(config.populationSize, 20, 5000, 600);
  // 0 is a valid smoothness weight (penalty off), so only fall back to the
  // default when the value is missing or not a number.
  const smoothnessInput = config.smoothnessWeight;
  const smoothnessWeight =
    smoothnessInput === undefined || smoothnessInput === null || smoothnessInput === "" ||
    !Number.isFinite(Number(smoothnessInput))
      ? 0.04
      : Number(smoothnessInput);
  return {
    populationSize,
    generations: clampInt(config.generations, 1, 20000, 1200),
    mutationRate: clamp(Number(config.mutationRate) || 0.45, 0.05, 1),
    complexityAllowance: clamp(Number(config.complexityAllowance) || 6, 1, 30),
    smoothnessWeight: clamp(smoothnessWeight, 0, 2),
    seed: config.seed ?? "function-estimator",
    crossoverRate: clamp(Number(config.crossoverRate ?? 0.3) || 0, 0, 1),
    maxNodes: clampInt(config.maxNodes, 8, 400, 80),
    dedupe: config.dedupe !== false,
    initialDepth: clampInt(config.initialDepth, 1, 7, 4),
    maxMutationDepth: clampInt(config.maxMutationDepth, 1, 7, 4),
    progressEvery: Math.max(1, Math.floor(clampInt(config.generations, 1, 20000, 1200) / 80))
  };
}

function seedPopulation(points, config, rng) {
  const seeds = commonSeeds(points).map(simplifyConstants);
  const unique = [];
  const seen = new Set();

  for (const seed of seeds) {
    const formula = toFormula(seed);
    if (!seen.has(formula)) {
      unique.push(seed);
      seen.add(formula);
    }
  }

  while (unique.length < Math.min(config.populationSize, 40)) {
    unique.push(boundedRandomTree(rng, 3, config.maxNodes));
  }

  return unique.slice(0, config.populationSize);
}

function commonSeeds(points) {
  const x = varNode();
  const one = constNode(1);
  const two = constNode(2);
  const seeds = [
    constNode(0),
    one,
    constNode(-1),
    x,
    binaryNode("add", x, one),
    binaryNode("sub", x, one),
    binaryNode("mul", x, two),
    unaryNode("neg", x),
    unaryNode("square", x),
    binaryNode("add", unaryNode("square", x), one),
    binaryNode("sub", unaryNode("square", x), one),
    unaryNode("sin", x),
    unaryNode("cos", x),
    unaryNode("sqrt", x),
    unaryNode("log", binaryNode("add", unaryNode("square", x), one))
  ];

  const line = linearSeed(points);
  if (line) {
    seeds.push(line);
  }

  return seeds;
}

function linearSeed(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return null;
  }

  const valid = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const meanX = valid.reduce((sum, point) => sum + point.x, 0) / valid.length;
  const meanY = valid.reduce((sum, point) => sum + point.y, 0) / valid.length;
  const denominator = valid.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  if (Math.abs(denominator) < EPSILON) {
    return constNode(meanY);
  }
  const numerator = valid.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  return binaryNode("add", binaryNode("mul", constNode(slope), varNode()), constNode(intercept));
}

function nextGeneration(scored, config, rng) {
  const next = [];
  const eliteCount = clamp(Math.ceil(config.populationSize * 0.04), 2, Math.min(20, scored.length));

  const seen = new Set();
  const isNew = (node) => {
    if (!config.dedupe) {
      return true;
    }
    const key = toFormula(node);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  };

  // Elites are the best distinct formulas, so copies of the leader cannot
  // take every elite slot.
  for (let index = 0; index < scored.length && next.length < eliteCount; index += 1) {
    if (isNew(scored[index].node)) {
      next.push(cloneNode(scored[index].node));
    }
  }

  while (next.length < config.populationSize) {
    if (rng() < 0.05) {
      next.push(boundedRandomTree(rng, config.initialDepth, config.maxNodes));
      continue;
    }

    const parent = tournamentSelect(scored, rng);
    let child = cloneNode(parent.node);

    if (rng() < config.crossoverRate) {
      child = crossoverTrees(child, tournamentSelect(scored, rng).node, rng);
    }

    const mutationPasses = rng() < config.mutationRate ? 1 + (rng() < config.mutationRate * 0.35 ? 1 : 0) : 0;

    for (let pass = 0; pass < mutationPasses; pass += 1) {
      child = mutateTree(child, rng, { maxDepth: config.maxMutationDepth });
    }

    if (rng() < 0.22) {
      child = simplifyTree(child);
    }

    // A formula already in the next generation gets one more mutation rather
    // than a second identical slot.
    if (!isNew(child)) {
      child = mutateTree(child, rng, { maxDepth: config.maxMutationDepth });
      isNew(child);
    }

    // Hard size cap: an oversized child is replaced by its (in-bounds) parent.
    if (nodeCount(child) > config.maxNodes) {
      child = cloneNode(parent.node);
    }

    next.push(child);
  }

  return next;
}

function tournamentSelect(scored, rng) {
  const tournamentSize = Math.min(scored.length, 5);
  let winner = scored[Math.floor(rng() * scored.length)];
  for (let index = 1; index < tournamentSize; index += 1) {
    const candidate = scored[Math.floor(rng() * scored.length)];
    if (candidate.score.loss < winner.score.loss) {
      winner = candidate;
    }
  }
  return winner;
}

function buildFitResult(scored, points, generation, config) {
  const best = scored[0];
  const bestFormula = toFormula(best.node);
  return {
    generation,
    formula: bestFormula,
    mse: best.score.mse,
    loss: best.score.loss,
    nodeCount: best.score.nodeCount,
    normalizedError: best.score.normalizedError,
    smoothness: best.score.smoothness,
    predictions: best.score.predictions,
    curve: makeCurve(best.node, points),
    candidates: distinctLeaders(scored, 10),
    config: {
      populationSize: config.populationSize,
      generations: config.generations,
      mutationRate: config.mutationRate,
      complexityAllowance: config.complexityAllowance,
      smoothnessWeight: config.smoothnessWeight,
      seed: config.seed
    }
  };
}

// The best `limit` formulas with repeats removed (the population is sorted
// best-first and can hold the same formula more than once).
function distinctLeaders(scored, limit) {
  const leaders = [];
  const seen = new Set();
  for (const entry of scored) {
    const formula = toFormula(entry.node);
    if (seen.has(formula)) {
      continue;
    }
    seen.add(formula);
    leaders.push({
      formula,
      mse: entry.score.mse,
      loss: entry.score.loss,
      nodeCount: entry.score.nodeCount
    });
    if (leaders.length === limit) {
      break;
    }
  }
  return leaders;
}

export function makeCurve(node, points, sampleCount = 180) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }

  const xValues = points.map((point) => point.x).filter(Number.isFinite);
  let minX = Math.min(...xValues);
  let maxX = Math.max(...xValues);
  const span = Math.max(maxX - minX, 1);
  minX -= span * 0.08;
  maxX += span * 0.08;

  if (Math.abs(maxX - minX) < EPSILON) {
    minX -= 1;
    maxX += 1;
  }

  const curve = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const x = minX + ((maxX - minX) * index) / (sampleCount - 1);
    curve.push({ x, y: evaluateNode(node, x) });
  }
  return curve;
}

export const examples = {
  quadratic: [
    { x: -3, y: 10 },
    { x: -2, y: 5 },
    { x: -1, y: 2 },
    { x: 0, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 5 },
    { x: 3, y: 10 }
  ],
  sparse: [
    { x: 0, y: 1 },
    { x: 1, y: 0 },
    { x: 3, y: 10 },
    { x: 5, y: 0 }
  ],
  prime: Array.from({ length: 25 }, (_, index) => {
    const x = index + 1;
    return { x, y: isPrime(x) ? 1 : 0 };
  }),
  sine: Array.from({ length: 13 }, (_, index) => {
    const x = -Math.PI + (Math.PI * 2 * index) / 12;
    return { x: rounded(x, 4), y: rounded(Math.sin(x), 4) };
  })
};

function isPrime(value) {
  if (value < 2) {
    return false;
  }
  for (let factor = 2; factor * factor <= value; factor += 1) {
    if (value % factor === 0) {
      return false;
    }
  }
  return true;
}
