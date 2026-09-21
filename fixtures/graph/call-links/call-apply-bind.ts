import { helper } from "./helper.js";

export function usesCallApplyBind(receiver: () => number): number {
  const a = helper.call(null, 1);
  const b = helper.apply(null, [2]);
  const c = receiver.call(null);
  return a + b + c;
}
