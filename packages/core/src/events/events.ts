import type { Diagnostic } from "../errors/errors.js";
import type { Finding } from "../domain/finding.js";
import type { ScanId } from "../domain/ids.js";

/** The analyzer lifecycle stages (Section 3 pipeline / Section 37D). Emitted in order, may repeat per-analyzer. */
export type LifecycleStage =
  | "initialize"
  | "discover"
  | "parse"
  | "index"
  | "analyze"
  | "correlate"
  | "finalize";

export interface ScanStartedEvent {
  readonly type: "scan:started";
  readonly scanId: ScanId;
  readonly profile: string;
}

export interface StageStartedEvent {
  readonly type: "stage:started";
  readonly scanId: ScanId;
  readonly stage: LifecycleStage;
}

export interface StageProgressEvent {
  readonly type: "stage:progress";
  readonly scanId: ScanId;
  readonly stage: LifecycleStage;
  /** 0 to 1. Analyzers that cannot estimate progress may omit this field entirely rather than fake it. */
  readonly fraction?: number;
  readonly message?: string;
}

export interface StageCompletedEvent {
  readonly type: "stage:completed";
  readonly scanId: ScanId;
  readonly stage: LifecycleStage;
  readonly durationMs: number;
}

export interface AnalyzerStartedEvent {
  readonly type: "analyzer:started";
  readonly scanId: ScanId;
  readonly analyzerId: string;
}

export interface AnalyzerCompletedEvent {
  readonly type: "analyzer:completed";
  readonly scanId: ScanId;
  readonly analyzerId: string;
  readonly durationMs: number;
  readonly findingCount: number;
}

export interface FindingEmittedEvent {
  readonly type: "finding:emitted";
  readonly scanId: ScanId;
  readonly finding: Finding;
}

export interface DiagnosticEvent {
  readonly type: "diagnostic";
  readonly scanId: ScanId;
  readonly diagnostic: Diagnostic;
}

export interface ScanCompletedEvent {
  readonly type: "scan:completed";
  readonly scanId: ScanId;
  readonly durationMs: number;
}

export interface ScanFailedEvent {
  readonly type: "scan:failed";
  readonly scanId: ScanId;
  readonly reason: string;
}

export interface ScanCancelledEvent {
  readonly type: "scan:cancelled";
  readonly scanId: ScanId;
}

export type ScanEvent =
  | ScanStartedEvent
  | StageStartedEvent
  | StageProgressEvent
  | StageCompletedEvent
  | AnalyzerStartedEvent
  | AnalyzerCompletedEvent
  | FindingEmittedEvent
  | DiagnosticEvent
  | ScanCompletedEvent
  | ScanFailedEvent
  | ScanCancelledEvent;

export type ScanEventListener = (event: ScanEvent) => void;

/** Minimal typed pub/sub surface the scan lifecycle publishes to. Implementations may be sync or async. */
export interface ScanEventEmitter {
  on(listener: ScanEventListener): () => void;
  emit(event: ScanEvent): void;
}
