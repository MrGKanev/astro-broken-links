import type { AstroIntegration, AstroConfig } from 'astro';
import { checkLinks } from './checker.js';
import type { IntegrationOptions } from './types.js';
export { checkLinks } from './checker.js';
export type * from './types.js';

export default function brokenLinks(options: IntegrationOptions = {}): AstroIntegration {
  let config: AstroConfig;
  let dynamicRoutes: RegExp[] = [];
  return {
    name: 'astro-broken-links',
    hooks: {
      'astro:config:done': context => { config = context.config; },
      'astro:routes:resolved': ({ routes }) => { dynamicRoutes = routes.flatMap(route => {
        const data = route as unknown as { isPrerendered?: boolean; prerender?: boolean; patternRegex?: RegExp; pattern?: RegExp | string };
        const pattern = data.patternRegex ?? data.pattern;
        return (data.isPrerendered ?? data.prerender) === false && pattern instanceof RegExp ? [pattern] : [];
      }); },
      'astro:build:done': async ({ dir, logger }) => {
        const result = await checkLinks({ ...options, directory: dir, site: config.site, base: config.base, format: config.build.format, trailingSlash: config.trailingSlash, redirects: config.redirects, dynamicRoutes });
        for (const item of result.diagnostics) logger.warn(`${item.page}:${item.line}:${item.column} [${item.code}] ${item.url} — ${item.message}`);
        logger.info(`Checked ${result.links} references in ${result.pages} pages; ${result.diagnostics.length} problems.`);
        if (result.diagnostics.length && options.failOnError !== false) throw new Error(`Link validation failed: ${result.diagnostics.length} problems. Set failOnError: false to report without failing.`);
      },
    },
  };
}
