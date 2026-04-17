#!/usr/bin/env node
import { spawn } from 'child_process';

const UNIT_TESTS = [
  'tests/hybrid-gateway.test.js',
  'tests/provider-models.unit.test.js',
  'tests/security-fixes.unit.test.js'
];

const INTEGRATION_TESTS = [
  'tests/api-integration.test.js',
  'tests/security-fixes.test.js'
];

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function usage() {
  console.log('Usage: node run-tests.js --unit | --integration');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--unit')) {
    process.exit(await run('npm', ['test', '--', ...UNIT_TESTS, '--forceExit']));
  }

  if (args.includes('--integration')) {
    process.exit(await run('npm', ['test', '--', ...INTEGRATION_TESTS, '--forceExit']));
  }

  usage();
  process.exit(1);
}

main();
