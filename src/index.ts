import type { AstroIntegration, AstroConfig } from 'astro';
import { checkLinks, formatReport } from './checker.js';
import type { IntegrationOptions } from './types.js';
export { checkLinks, formatReport } from './checker.js';
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
        const lines = formatReport(result);
        for (const line of lines.slice(0, -1)) logger.warn(line);
        logger.info(lines.at(-1)!);
        if (result.summary.newErrors && options.failOnError !== false) throw new Error(`Link validation failed: ${result.summary.newErrors} new errors. Set failOnError: false to report without failing.`);
      },
    },
  };
}
