import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { extname } from 'node:path';

function inputs(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = dir + '/' + entry.name;
    if (entry.isDirectory()) return inputs(path);
    return entry.name.endsWith('.meta') || entry.name === 'generated.sha256' ? [] : [path];
  });
}

export function configFingerprint() {
  const config = JSON.parse(readFileSync('project.esproject', 'utf8')).tools.luban;
  const hash = createHash('sha256').update(JSON.stringify(config));
  const files = [...inputs('config/luban'), ...inputs(config.codeDir), ...inputs(config.dataDir)].sort();
  for (const file of files) {
    const bytes = readFileSync(file);
    const text = ['.ts', '.json', '.csv', '.xml', '.conf'].includes(extname(file));
    hash.update(file + '\0').update(text ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes).update('\0');
  }
  return hash.digest('hex');
}
