import { helper } from "./helper.js";

function localAdd(a: number, b: number): number {
  return a + b;
}

export function callsBoth(): number {
  return localAdd(1, 2) + helper(3);
}
