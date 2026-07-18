export type RequestOnceOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type RequestOnceResult = {
  ok: boolean;
  status: number | null;
  elapsedMs: number;
  error?: string;
};

export type LoadTestOptions = {
  origin?: string;
  path?: string;
  levels?: number[];
  requestCount?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type LoadTestLevelResult = {
  concurrency: number;
  requestCount: number;
  path: string;
  wallMs: number;
  successCount: number;
  errorCount: number;
  requestsPerSecond: number;
  p50Ms: number;
  p95Ms: number;
};

export declare const DEFAULT_ORIGIN: string;
export declare const DEFAULT_PATH: string;
export declare const DEFAULT_CONCURRENCY_LEVELS: number[];
export declare const DEFAULT_REQUESTS_PER_LEVEL: number;
export declare const DEFAULT_TIMEOUT_MS: number;

export declare function requestOnce(url: string, options?: RequestOnceOptions): Promise<RequestOnceResult>;

export declare function percentile(values: readonly number[], p: number): number;

export declare function runConcurrencyLevel(
  concurrency: number,
  options?: LoadTestOptions,
): Promise<LoadTestLevelResult>;

export declare function runLoadTest(options?: LoadTestOptions): Promise<LoadTestLevelResult[]>;

export declare function formatLoadTestReport(results: readonly LoadTestLevelResult[]): string;
