export interface LinkContext { page: string; tag: string; attribute: string; line: number; column: number }
export type IgnoreRule = string | RegExp | ((url: string, context: LinkContext) => boolean);
export interface ExternalOptions {
  concurrency?: number;
  /** Maximum active HTTP requests per hostname, including redirect hops. Default: 2. */
  perHostConcurrency?: number;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  headers?: Record<string, string>;
  cache?: false | { file: string; ttl?: number };
}
export interface CheckOptions {
  /** Built HTML and assets. Required by the standalone API. */
  directory: string | URL;
  site?: string;
  base?: string;
  trailingSlash?: 'always' | 'never' | 'ignore';
  format?: 'directory' | 'file' | 'preserve';
  redirects?: Record<string, string | { destination: string; status?: number }>;
  /** Astro supplies patterns for on-demand routes; their response bodies cannot be checked. */
  dynamicRoutes?: RegExp[];
  ignore?: IgnoreRule[];
  exclude?: string[];
  anchors?: boolean;
  assets?: boolean;
  external?: boolean | ExternalOptions;
  concurrency?: number;
  /** Write a deterministic machine-readable report. Relative to process.cwd(). */
  report?: string;
  rules?: Partial<Record<DiagnosticCode, SeverityRule>>;
  baseline?: { file: string; update?: boolean };
}
export type DiagnosticCode = 'missing-file' | 'missing-anchor' | 'trailing-slash' | 'invalid-url' | 'outside-base' | 'redirect-loop' | 'http-error' | 'network-error';
export type Severity = 'error' | 'warning';
export type Finding = LinkContext & { url: string; code: DiagnosticCode; message: string; status?: number };
export type SeverityRule = Severity | ((finding: Readonly<Finding>) => Severity);
export interface Diagnostic extends LinkContext {
  url: string;
  code: DiagnosticCode;
  severity: Severity;
  known: boolean;
  message: string;
  status?: number;
}
export interface CheckResult {
  pages: number;
  links: number;
  externalRequests: number;
  skipped: number;
  diagnostics: Diagnostic[];
  summary: { errors: number; warnings: number; known: number; newErrors: number; newWarnings: number; resolved: number };
}
export type IntegrationOptions = Omit<CheckOptions, 'directory' | 'site' | 'base' | 'format' | 'trailingSlash' | 'redirects' | 'dynamicRoutes'> & {
  failOnError?: boolean;
};
