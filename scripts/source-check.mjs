import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const roots = ['apps/api/src', 'apps/api/test', 'apps/web/src', 'scripts'];
const extensions = new Set(['.ts', '.tsx', '.mjs']);
const failures = [];
let checked = 0;

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) { await visit(name); continue; }
    if (!entry.isFile() || !extensions.has(path.extname(name))) continue;
    checked++;
    const text = await readFile(name, 'utf8');
    if (/(^|\n)(<{7}|={7}|>{7})/.test(text)) failures.push(`${name}: unresolved merge marker`);
    if (!text.endsWith('\n')) failures.push(`${name}: missing final newline`);
  }
}
for (const root of roots) await visit(root);
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`PASS source hygiene: ${checked} files checked`);
