import assert from "node:assert/strict";
import {
  binaryNode,
  constNode,
  evaluateNode,
  evolve,
  parsePointText,
  rowsToPoints,
  simplifyConstants,
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
    [binaryNode("sub", x, binaryNode("sub", x, constNode(1))), "x - (x - 1)"]
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
      .replace(/\b(sin|cos|exp|log|sqrt)\(/g, "Math.$1(");
  for (const [node] of cases) {
    const fromText = new Function("x", `return ${toJs(toFormula(node))};`)(1.7);
    assert.ok(Math.abs(fromText - evaluateNode(node, 1.7)) < 1e-9, `${toFormula(node)} misreads`);
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

testProtectedOperators();
testFormulaPrinting();
testRowsToPoints();
testSmoothnessCanBeZero();
testCsvParsing();
testSimplification();
testQuadraticEvolution();

console.log("Smoke tests passed.");
