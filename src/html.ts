import { createReadStream } from 'node:fs';
import { SAXParser } from 'parse5-sax-parser';
import type { LinkContext } from './types.js';
export interface Reference extends Omit<LinkContext, 'page'> { url: string; navigation: boolean }
export interface HtmlData { ids: Set<string>; references: Reference[]; base?: string }

// Tokenize without constructing or retaining a DOM. The parser handles entities, comments and raw text.
export async function readHtml(file: string, references = true, assets = true): Promise<HtmlData> {
  const result: HtmlData = { ids: new Set(), references: [] };
  const parser = new SAXParser({ sourceCodeLocationInfo: references });
  parser.on('startTag', token => {
    const attrs = new Map(token.attrs.map(a => [a.name, a.value]));
    const id = attrs.get('id');
    if (id !== undefined) result.ids.add(id);
    const name = token.tagName === 'a' ? attrs.get('name') : undefined;
    if (name !== undefined) result.ids.add(name);
    if (!references) return;
    if (token.tagName === 'base' && result.base === undefined && attrs.has('href')) result.base = attrs.get('href');
    const add = (attribute: string, navigation = false, override?: string) => {
      const url = override ?? attrs.get(attribute);
      if (url === undefined) return;
      const location = token.sourceCodeLocation as (NonNullable<typeof token.sourceCodeLocation> & { attrs?: Record<string, NonNullable<typeof token.sourceCodeLocation>> }) | undefined;
      const loc = location?.attrs?.[attribute] ?? location;
      result.references.push({ url, tag: token.tagName, attribute, navigation, line: loc?.startLine ?? 1, column: loc?.startCol ?? 1 });
    };
    if (token.tagName === 'a' || token.tagName === 'area') add('href', true);
    if (!assets) return;
    if (['img', 'script', 'iframe', 'source', 'audio', 'video', 'track', 'embed', 'input'].includes(token.tagName)) add('src');
    if (token.tagName === 'link') add('href');
    if (token.tagName === 'object') add('data');
    if (token.tagName === 'video') add('poster');
    if (token.tagName === 'img' || token.tagName === 'source') {
      // HTML's srcset URL token ends on whitespace. Commas inside URLs (notably data:) are valid.
      const srcset = attrs.get('srcset');
      if (srcset) {
        let remaining = srcset;
        while (remaining.length) {
          remaining = remaining.replace(/^[\s,]+/, '');
          const match = /^\S+/.exec(remaining);
          if (!match) break;
          let url = match[0];
          remaining = remaining.slice(url.length);
          if (url.endsWith(',')) url = url.replace(/,+$/, '');
          else { const end = remaining.indexOf(','); remaining = end < 0 ? '' : remaining.slice(end + 1); }
          add('srcset', false, url);
        }
      }
    }
  });
  const input = createReadStream(file, { encoding: 'utf8' });
  try { for await (const chunk of input) parser.write(chunk as string); parser.end(); }
  finally { input.destroy(); }
  return result;
}
