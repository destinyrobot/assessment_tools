#!/usr/bin/env node
/**
 * Copies the canonical `shared/` modules into `supabase/functions/_shared/`
 * so the Supabase CLI bundles them with every Edge Function.
 *
 * Run automatically before `npm run build`, and any time you edit shared/.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'shared');
const outDir = join(root, 'supabase', 'functions', '_shared');

const BANNER = '// AUTO-GENERATED FROM shared/ — do not edit here.\n// Run `npm run sync:shared` after editing the files in shared/.\n';

const files = (await readdir(srcDir)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

await mkdir(outDir, { recursive: true });

let changed = 0;
for (const file of files) {
  const source = await readFile(join(srcDir, file), 'utf8');
  const body = source.startsWith(BANNER) ? source.slice(BANNER.length) : source;
  const target = join(outDir, file);
  const next = BANNER + body;
  let current = null;
  try {
    current = await readFile(target, 'utf8');
  } catch {
    current = null;
  }
  if (current !== next) {
    await writeFile(target, next, 'utf8');
    changed += 1;
    console.log(`synced shared/${file} -> supabase/functions/_shared/${file}`);
  }
}

console.log(
  changed === 0
    ? `shared modules already in sync (${files.length} files)`
    : `synced ${changed} of ${files.length} shared modules`,
);