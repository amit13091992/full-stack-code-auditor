import { add } from "./math.js";
import { double } from "./utils";
import leftPad from "left-pad";
import { missing } from "./does-not-exist.js";

export function compute(n: number): number {
  return double(add(n, leftPad(n))) + missing;
}
