import { helper } from "./does-not-exist.js";
import React from "react";

export function useHelper(): unknown {
  return React.createElement === undefined ? helper : null;
}
