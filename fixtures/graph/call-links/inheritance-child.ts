import { Base } from "./inheritance-base.js";

// Cross-file `extends` is Phase 3's documented same-file-only resolution gap: `extendsSymbolId`
// only ever gets set from a same-file symbol, so `Child` here has no recorded superclass link at
// all (not merely an unresolved one) even though `Base` is imported. `callsGreet` calling
// `this.greet()` therefore can't be resolved better than "unknown" (see cross-file-inheritance
// fixture assertions in call-graph.test.ts).
export class Child extends Base {
  callsGreet(): string {
    return this.greet();
  }
}
