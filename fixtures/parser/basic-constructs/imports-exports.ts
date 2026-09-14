import defaultExport from "./default-target.js";
import * as ns from "./namespace-target.js";
import { named, other as renamed } from "./named-target.js";
import "./side-effect-target.js";

export { named, renamed };
export * from "./re-export-target.js";
export default defaultExport;

export async function loadNamespace() {
  const mod = await import("./dynamic-target.js");
  return mod;
}
