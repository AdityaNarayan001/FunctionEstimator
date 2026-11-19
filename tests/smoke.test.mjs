import assert from "node:assert/strict";
import {
  binaryNode,
  constNode,
  evaluateNode,
  evolve,
  parsePointText,
  simplifyConstants,
  toFormula,
  unaryNode,
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

testProtectedOperators();
testCsvParsing();
testSimplification();
testQuadraticEvolution();

console.log("Smoke tests passed.");
