#!/usr/bin/env node
/**
 * Frontend dev entry: runs Vite dev server (with /api proxy from vite.config).
 * Usage: node scripts/dev-frontend.mjs   or   npm run dev
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(frontendRoot, '..');
const inFrontend = path.join(frontendRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const inWorkspace = path.join(workspaceRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const viteBin = fs.existsSync(inFrontend) ? inFrontend : inWorkspace;

const child = spawn(process.execPath, [viteBin], {
  cwd: frontendRoot,
  stdio: 'inherit',
  env: { ...process.env, FORCE_COLOR: '1' },
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
