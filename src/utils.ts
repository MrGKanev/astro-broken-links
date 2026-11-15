import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicJson(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n');
  await rename(temporary, file);
}
export async function pool<T>(items: Iterable<T>, concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  const iterator = items[Symbol.iterator]();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let next = iterator.next(); !next.done; next = iterator.next()) await task(next.value);
  }));
}
export function positive(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1) throw new TypeError(`${name} must be a positive integer`);
  return result;
}
/** Small, anchored glob dialect: * matches one path segment, ** matches across slashes. */
export function glob(pattern: string, value: string): boolean {
  const source = pattern.split(/(\*\*|\*)/).map(part => part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return new RegExp(`^${source}$`).test(value);
}
