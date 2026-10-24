import { cpSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const source = fileURLToPath(new URL('../web/dist/', import.meta.url));
const target = fileURLToPath(
  new URL('../api/src/Merlin.Api/wwwroot/', import.meta.url),
);
if (!existsSync(source))
  throw new Error('Build the frontend before copying it.');
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
