import type { ResultExporter } from "@code-analyzer/core";
import { htmlExporter } from "./html.js";
import { jsonExporter } from "./json.js";
import { sarifExporter } from "./sarif.js";

export { jsonExporter } from "./json.js";
export { sarifExporter } from "./sarif.js";
export { htmlExporter } from "./html.js";

export type ExportFormat = ResultExporter["format"];

const EXPORTERS: Readonly<Record<ExportFormat, ResultExporter>> = {
  json: jsonExporter,
  sarif: sarifExporter,
  html: htmlExporter,
};

export function getExporter(format: ExportFormat): ResultExporter {
  return EXPORTERS[format];
}
