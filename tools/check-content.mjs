import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFingerprint } from './config-fingerprint.mjs';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const groups = read('.esengine/asset-groups.json').groups;
const project = read('project.esproject');
assert.equal(project.version, read('package.json').version, 'Project and build versions differ');

function files(dir) {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(entry => {
    const file = join(dir, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
const assets = files('assets').filter(f => !f.endsWith('.meta'));
for (const source of [...files('src/framework'), ...files('src/modules')].filter(f => f.endsWith('.ts'))) {
  const allowed = ['src/framework/'];
  if (source.startsWith(join('src', 'modules') + sep)) allowed.push('src/modules/');
  const imports = ts.preProcessFile(readFileSync(resolve(root, source), 'utf8')).importedFiles;
  for (const { fileName } of imports.filter(i => i.fileName.startsWith('.'))) {
    const target = relative(root, resolve(root, source, '..', fileName)).split(sep).join('/');
    assert(allowed.some(prefix => target.startsWith(prefix)), source + ' depends on product-specific code: ' + target);
  }
}
const ids = new Set();
for (const path of assets) {
  const meta = read(path + '.meta');
  assert.match(meta.uuid, /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i, path + ' invalid UUID');
  assert(!ids.has(meta.uuid), path + ' duplicate UUID');
  ids.add(meta.uuid);
}
assert(assets.includes(join(...project.defaultScene.split('/'))), 'Startup scene missing');
const config = project.tools.luban;
const generated = read(config.dataDir + '/content_experiences.json');
assert.equal(configFingerprint(), readFileSync(resolve(root, 'config/luban/generated.sha256'), 'utf8').trim(),
  'Inputs or generated outputs have changed. Run npm run config:generate.');
assert(existsSync(resolve(root, config.codeDir, 'schema.ts')), 'Generated table reader missing');
const experiences = new Set();
for (const [index, entry] of generated.entries()) {
  const at = 'content_experiences.json row ' + (index + 1);
  assert(typeof entry.id === 'string' && entry.id.trim() && !experiences.has(entry.id), at + ' invalid or duplicate ID');
  experiences.add(entry.id);
  const normalized = relative(root, resolve(root, entry.prefab)).split(sep).join('/');
  assert(normalized === entry.prefab && normalized.startsWith('assets/') && existsSync(resolve(root, normalized)), at + ' invalid prefab ' + entry.prefab);
  const owner = Object.entries(groups).filter(([, def]) => normalized.startsWith(def.folder + '/'))
    .sort((a, b) => b[1].folder.length - a[1].folder.length)[0];
  assert(owner?.[0] === entry.group && owner[1].alwaysInclude, at + ' check delivery group and alwaysInclude for ' + normalized);
}
console.log('Checked ' + assets.length + ' assets and ' + experiences.size + ' experience rows.');
