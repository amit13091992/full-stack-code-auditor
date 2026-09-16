import { usedHelper } from "./used.js";

// No export here on purpose: this module has nothing to export, so it must never be flagged by
// quality/unused-export regardless of its own IMPORTS edges — the rule only fires on modules that
// export something.
console.log(usedHelper());
