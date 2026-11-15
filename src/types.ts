export interface LinkContext { page: string; tag: string; attribute: string; line: number; column: number }
export type IgnoreRule = string | RegExp | ((url: string, context: LinkContext) => boolean);
export interface ExternalOptions {
  concurrency?: number;
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
}
export interface Diagnostic extends LinkContext {
  url: string;
  code: 'missing-file' | 'missing-anchor' | 'trailing-slash' | 'invalid-url' | 'outside-base' | 'redirect-loop' | 'http-error' | 'network-error';
  message: string;
  status?: number;
}
export interface CheckResult {
  pages: number;
  links: number;
  externalRequests: number;
  skipped: number;
  diagnostics: Diagnostic[];
}
export type IntegrationOptions = Omit<CheckOptions, 'directory' | 'site' | 'base' | 'format' | 'trailingSlash' | 'redirects' | 'dynamicRoutes'> & {
  failOnError?: boolean;
};
