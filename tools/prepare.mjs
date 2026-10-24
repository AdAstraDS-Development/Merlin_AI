import { existsSync } from 'node:fs';
if (process.env.HUSKY !== '0' && !process.env.CI && existsSync('.git')) {
  const { default: husky } = await import('husky');
  const message = husky();
  if (message) console.log(message);
}
