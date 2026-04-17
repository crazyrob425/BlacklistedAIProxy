#!/usr/bin/env node
import { spawn } from 'child_process';

const suites = [
  { name: 'unit', args: ['run', 'test:unit'] },
  { name: 'integration', args: ['run', 'test:integration'] }
];

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const results = [];
  for (const suite of suites) {
    const code = await run('npm', suite.args);
    results.push({ suite: suite.name, passed: code === 0, code });
  }

  console.log('\n=== Test Summary ===');
  results.forEach((r) => console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.suite}${r.passed ? '' : ` (exit ${r.code})`}`));
  const hasFailures = results.some((r) => !r.passed);
  process.exit(hasFailures ? 1 : 0);
}

main();
