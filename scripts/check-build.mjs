// Fails the build if a compiled file still imports through a source-only
// shortcut like "@/middleware": Node cannot resolve those, so the app would
// build fine and then crash on start (in Docker, for example).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const left = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith('.js')) {
      const found = readFileSync(path, 'utf8').match(/from ["']@\/[^"']+["']/g);
      if (found) left.push(`${path}: ${[...new Set(found)].join(', ')}`);
    }
  }
};
walk('dist');
if (left.length > 0) {
  console.error('Unresolved "@/" imports in the build:\n' + left.join('\n'));
  process.exit(1);
}
console.log('Build imports are all resolved.');
