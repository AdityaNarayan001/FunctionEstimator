import assert from "node:assert/strict";
import {
  binaryNode,
  constNode,
  evaluateNode,
  crossoverTrees,
  createRng,
  evolve,
  mutateTree,
  nodeCount,
  parsePointText,
  rowsToPoints,
  simplifyConstants,
  simplifyTree,
  toFormula,
  unaryNode,
  validatePoints,
  varNode
} from "../src/symbolic-core.js";

function testProtectedOperators() {
  const nodes = [
    binaryNode("div", constNode(3), constNode(0)),
    unaryNode("log", constNode(0)),
    unaryNode("sqrt", constNode(-9)),
    unaryNode("exp", constNode(5000)),
    unaryNode("square", constNode(1e9))
  ];

  for (const node of nodes) {
    const value = evaluateNode(node, 2);
    assert.equal(Number.isFinite(value), true, `${toFormula(node)} should evaluate to a finite value`);
  }
}

function testCsvParsing() {
  const parsed = parsePointText("x,y\n0,1\n1 2\nbad,row\n2;5");
  assert.deepEqual(parsed.points, [
    { x: 0, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 5 }
  ]);
  assert.equal(parsed.errors.length, 1);
}

function testSimplification() {
  const tree = binaryNode("add", binaryNode("mul", constNode(2), constNode(3)), varNode());
  const simplified = simplifyConstants(tree);
  assert.equal(toFormula(simplified), "6 + x");
}

function testQuadraticEvolution() {
  const points = [
    { x: -3, y: 10 },
    { x: -2, y: 5 },
    { x: -1, y: 2 },
    { x: 0, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 5 },
    { x: 3, y: 10 }
  ];
  const result = evolve(points, {
    populationSize: 160,
    generations: 80,
    mutationRate: 0.4,
    complexityAllowance: 6,
    smoothnessWeight: 0.02,
    seed: "quadratic-test"
  });

  assert.ok(result.mse < 0.001, `expected low MSE, got ${result.mse} for ${result.formula}`);
}

function testFormulaPrinting() {
  const x = varNode();
  const cases = [
    [unaryNode("square", unaryNode("neg", x)), "(-x)^2"],
    [unaryNode("neg", unaryNode("square", x)), "-x^2"],
    [unaryNode("square", constNode(-3)), "(-3)^2"],
    [unaryNode("neg", constNode(-3)), "-(-3)"],
    [unaryNode("neg", unaryNode("neg", x)), "-(-x)"],
    [binaryNode("sub", x, constNode(-3)), "x - (-3)"],
    [binaryNode("add", x, unaryNode("neg", x)), "x + (-x)"],
    [binaryNode("mul", constNode(-2), x), "-2 * x"],
    [unaryNode("square", unaryNode("square", x)), "(x^2)^2"],
    [unaryNode("square", unaryNode("sin", x)), "sin(x)^2"],
    [unaryNode("square", binaryNode("add", x, constNode(1))), "(x + 1)^2"],
    [unaryNode("sin", constNode(-3)), "sin(-3)"],
    [binaryNode("sub", x, binaryNode("sub", x, constNode(1))), "x - (x - 1)"],
    [unaryNode("log", x), "log(abs(x))"],
    [unaryNode("sqrt", binaryNode("sub", x, constNode(1))), "sqrt(abs(x - 1))"],
    [unaryNode("sqrt", binaryNode("add", unaryNode("square", x), constNode(1))), "sqrt(x^2 + 1)"],
    [unaryNode("log", unaryNode("exp", x)), "log(exp(x))"]
  ];

  for (const [node, expected] of cases) {
    assert.equal(toFormula(node), expected);
  }

  // The printed text must mean what the tree computes under normal math rules.
  // JS rejects "-x**2", so a unary minus is rewritten as "0-", which binds the same way.
  const toJs = (formula) =>
    formula
      .replace(/(^|\()-/g, "$10-")
      .replace(/\^2/g, "**2")
      .replace(/\b(sin|cos|exp|log|sqrt|abs)\(/g, "Math.$1(");
  // Checked on both sides of zero, where the protected log and sqrt matter.
  for (const [node] of cases) {
    for (const sample of [1.7, -2.3]) {
      const fromText = new Function("x", `return ${toJs(toFormula(node))};`)(sample);
      assert.ok(Math.abs(fromText - evaluateNode(node, sample)) < 1e-5, `${toFormula(node)} misreads at ${sample}`);
    }
  }
}

function testRowsToPoints() {
  const rows = [
    { x: "1", y: "2" },
    { x: "", y: "" },
    { x: " ", y: "" },
    { x: "3", y: "" },
    { x: 0, y: 0 }
  ];
  const points = rowsToPoints(rows);
  assert.equal(points.length, 3);
  assert.deepEqual(points[0], { x: 1, y: 2 });
  assert.equal(Number.isNaN(points[1].y), true);
  assert.deepEqual(points[2], { x: 0, y: 0 });
  assert.equal(validatePoints(points).length, 1);
}

function testSmoothnessCanBeZero() {
  const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 4 }];
  const run = (smoothnessWeight) =>
    evolve(points, { populationSize: 20, generations: 1, smoothnessWeight }).config.smoothnessWeight;
  assert.equal(run(0), 0);
  assert.equal(run("0"), 0);
  assert.equal(run(""), 0.04);
  assert.equal(run(undefined), 0.04);
  assert.equal(run(0.5), 0.5);
}

function testCsvHeaderAfterBlankLine() {
  const parsed = parsePointText("\n\nx,y\n1,2\n3,4");
  assert.equal(parsed.points.length, 2);
  assert.equal(parsed.errors.length, 0);
}

function testSimplifyTree() {
  const x = varNode();
  const cases = [
    [binaryNode("add", x, constNode(0)), "x"],
    [binaryNode("mul", constNode(1), x), "x"],
    [binaryNode("mul", unaryNode("sin", x), constNode(0)), "0"],
    [binaryNode("sub", unaryNode("sin", x), unaryNode("sin", x)), "0"],
    [binaryNode("sub", constNode(0), x), "-x"],
    [binaryNode("div", x, constNode(1)), "x"],
    [unaryNode("neg", unaryNode("neg", x)), "x"],
    [binaryNode("add", binaryNode("mul", constNode(2), constNode(3)), binaryNode("mul", x, constNode(1))), "6 + x"],
    [binaryNode("div", x, x), "x / x"]
  ];
  for (const [node, expected] of cases) {
    const simplified = simplifyTree(node);
    assert.equal(toFormula(simplified), expected);
    for (const sample of [-2.5, 0.75, 4]) {
      assert.ok(Math.abs(evaluateNode(simplified, sample) - evaluateNode(node, sample)) < 1e-9);
    }
  }
}

function testCrossoverAndMutationKeepValidTrees() {
  const rng = createRng("operators");
  const first = binaryNode("add", unaryNode("square", varNode()), constNode(1));
  const second = unaryNode("sin", binaryNode("mul", varNode(), constNode(2)));
  const firstText = toFormula(first);
  for (let round = 0; round < 200; round += 1) {
    const child = mutateTree(crossoverTrees(first, second, rng), rng);
    assert.ok(nodeCount(child) >= 1);
    assert.equal(Number.isFinite(evaluateNode(child, 1.3)), true);
    assert.equal(typeof toFormula(child), "string");
  }
  assert.equal(toFormula(first), firstText, "parents must not be modified");
}

function testSizeCapAndDeterminism() {
  const points = [0.5, 1, 1.5, 2, 3, 4, 6, 8].map((x) => ({ x, y: 3 / x + x / 2 }));
  const config = { populationSize: 120, generations: 60, maxNodes: 12, seed: "cap" };
  const reports = [];
  const result = evolve(points, config, (progress) => reports.push(progress));
  assert.ok(reports.length > 2);
  for (const report of reports) {
    assert.ok(report.candidates.every((candidate) => candidate.nodeCount <= 12), "size cap must hold in every generation");
  }
  assert.equal(new Set(result.candidates.map((candidate) => candidate.formula)).size, result.candidates.length);
  assert.equal(evolve(points, config).formula, result.formula, "same seed must give the same formula");
}

testProtectedOperators();
testCsvHeaderAfterBlankLine();
testSimplifyTree();
testCrossoverAndMutationKeepValidTrees();
testSizeCapAndDeterminism();
testFormulaPrinting();
testRowsToPoints();
testSmoothnessCanBeZero();
testCsvParsing();
testSimplification();
testQuadraticEvolution();

console.log("Smoke tests passed.");
