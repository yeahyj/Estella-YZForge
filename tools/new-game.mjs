import { access, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const [id, destination] = process.argv.slice(2);
if (!id || !/^[a-z][a-z0-9-]*$/i.test(id) || !destination) {
  throw new Error('Usage: npm run game:new -- <game-id> <new-project-directory>');
}
const packageName = id.toLowerCase();
const template = fileURLToPath(new URL('../', import.meta.url));
const target = resolve(destination);
const inside = relative(template, target);
if (!inside || !(inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside))) {
  throw new Error('Choose a directory outside this project. Estella indexes files below the project root.');
}
const parent = dirname(target);
await mkdir(parent, { recursive: true });
async function exists(path) {
  try { await access(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
if (await exists(target)) throw new Error('Destination already exists: ' + target);
const sourcePackage = JSON.parse(await readFile(join(template, 'package.json'), 'utf8'));
if (sourcePackage.gameTemplate.id === id) throw new Error('Choose a new game ID so its saves are isolated.');

const stage = await mkdtemp(join(parent, '.estella-new-'));
let published = false;
try {
  const inputs = ['assets', 'src', 'config', 'tools', 'tests', 'acceptance', 'docs', 'README.md', '.gitignore',
    'tsconfig.json', 'project.esproject', 'package.json', 'package-lock.json', '.esengine/asset-groups.json'];
  for (const optional of ['.esengine/plugins', '.esengine/platforms']) {
    if (await exists(join(template, optional))) inputs.push(optional);
  }
  for (const path of inputs) {
    await cp(join(template, path), join(stage, path), { recursive: true,
      filter: file => !['.types', 'node_modules'].includes(basename(file)) });
  }
  async function update(path, change) {
    const file = join(stage, path);
    const data = JSON.parse(await readFile(file, 'utf8'));
    change(data);
    await writeFile(file, JSON.stringify(data, null, 2) + '\n');
  }
  await update('package.json', pkg => { pkg.name = packageName; pkg.gameTemplate.id = id; });
  await update('project.esproject', project => { project.name = id; });
  await update('package-lock.json', lock => { lock.name = packageName; lock.packages[''].name = packageName; });
  if (await exists(target)) throw new Error('Destination already exists: ' + target);
  await rename(stage, target);
  published = true;
  console.log('Created ' + id + ' at ' + target + '. Open project.esproject in Estella, then run npm ci and npm run check.');
} finally {
  if (!published && dirname(stage) === parent && basename(stage).startsWith('.estella-new-')) {
    await rm(stage, { recursive: true, force: true });
  }
}
