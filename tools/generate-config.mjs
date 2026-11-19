import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { configFingerprint } from './config-fingerprint.mjs';

const { tools: { luban } } = JSON.parse(readFileSync('project.esproject', 'utf8'));
const dll = process.env.LUBAN_DLL || '.tools/luban/Luban.dll';
if (!existsSync(dll)) throw new Error('Provide .tools/luban/Luban.dll or set LUBAN_DLL (Luban 5.1.0).');
const localRuntime = resolve('.tools/dotnet', process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
const run = spawnSync(process.env.DOTNET_EXE || (existsSync(localRuntime) ? localRuntime : 'dotnet'), [
  resolve(dll), '-t', luban.target, '-c', luban.codeTarget, '-d', luban.dataTarget,
  '--conf', resolve(luban.conf), '-x', 'outputCodeDir=' + resolve(luban.codeDir),
  '-x', 'outputDataDir=' + resolve(luban.dataDir),
], { stdio: 'inherit' });
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
if (run.status === 0) writeFileSync('config/luban/generated.sha256', configFingerprint() + '\n');
