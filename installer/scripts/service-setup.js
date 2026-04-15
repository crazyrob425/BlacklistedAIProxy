/**
 * BlacklistedAIProxy — Service Setup Helper
 *
 * Used by the installer and uninstaller for service management tasks that
 * require Node.js-level logic (e.g., config patching, log rotation setup).
 *
 * Usage:
 *   node service-setup.js install   <installDir>
 *   node service-setup.js uninstall <installDir>
 *   node service-setup.js status
 *   node service-setup.js start
 *   node service-setup.js stop
 */

import { exec } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execAsync  = promisify(exec);
const __dirname  = dirname(fileURLToPath(import.meta.url));
const SERVICE    = 'BlacklistedAIProxy';
const WATCHDOG   = 'BlacklistedAIProxyWatchdog';

const EXEC_TIMEOUT_MS = 60_000;  // 60 s — allows for slow systems / registry writes

const [_node, _script, command, installDir = __dirname] = process.argv;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function run(cmd) {
    try {
        const { stdout, stderr } = await execAsync(cmd, { timeout: EXEC_TIMEOUT_MS });
        return { ok: true, out: stdout.trim(), err: stderr.trim() };
    } catch (e) {
        return { ok: false, out: '', err: e.message };
    }
}

function ensureDir(p) {
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function log(msg) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [service-setup] ${msg}`);
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdInstall(dir) {
    log(`Installing service in: ${dir}`);

    // 1. Create logs directory
    ensureDir(join(dir, 'logs'));
    log('Logs directory ready.');

    // 2. Bootstrap config.json from example if it doesn't exist
    const configDst = join(dir, 'configs', 'config.json');
    const configSrc = join(dir, 'configs', 'config.json.example');
    if (!existsSync(configDst) && existsSync(configSrc)) {
        copyFileSync(configSrc, configDst);
        log('config.json created from example.');
    }

    // 3. Verify Node.js runtime
    const nodeExe = join(dir, 'runtime', 'node.exe');
    if (!existsSync(nodeExe)) {
        log(`WARNING: Bundled runtime not found at ${nodeExe} — will use system Node.js`);
    } else {
        const { out } = await run(`"${nodeExe}" --version`);
        log(`Bundled Node.js: ${out}`);
    }

    log('Service setup complete. NSSM service registration handled by the installer.');
}

async function cmdUninstall(dir) {
    log('Stopping and removing services...');

    const nssmExe = join(dir, 'tools', 'nssm.exe');
    if (!existsSync(nssmExe)) {
        log('NSSM not found — attempting sc.exe fallback');
        await run(`sc stop "${WATCHDOG}"`);
        await run(`sc delete "${WATCHDOG}"`);
        await run(`sc stop "${SERVICE}"`);
        await run(`sc delete "${SERVICE}"`);
        return;
    }

    // Stop watchdog first to prevent it restarting the main service
    await run(`"${nssmExe}" stop "${WATCHDOG}"`);
    await new Promise(r => setTimeout(r, 2000));
    const rw = await run(`"${nssmExe}" remove "${WATCHDOG}" confirm`);
    log(`Watchdog remove: ${rw.ok ? 'OK' : rw.err}`);

    await run(`"${nssmExe}" stop "${SERVICE}"`);
    await new Promise(r => setTimeout(r, 2000));
    const rs = await run(`"${nssmExe}" remove "${SERVICE}" confirm`);
    log(`Service remove: ${rs.ok ? 'OK' : rs.err}`);

    log('Service uninstall complete.');
}

async function cmdStatus() {
    const { out: sOut } = await run(`sc query "${SERVICE}"`);
    const { out: wOut } = await run(`sc query "${WATCHDOG}"`);

    const sState = (sOut.match(/STATE\s+:\s+\d+\s+(\S+)/) || [])[1] || 'UNKNOWN';
    const wState = (wOut.match(/STATE\s+:\s+\d+\s+(\S+)/) || [])[1] || 'UNKNOWN';

    log(`${SERVICE}:        ${sState}`);
    log(`${WATCHDOG}: ${wState}`);
}

async function cmdStart() {
    const r = await run(`net start "${SERVICE}"`);
    log(r.ok ? `${SERVICE} started.` : `Failed to start ${SERVICE}: ${r.err}`);
}

async function cmdStop() {
    // Stop watchdog first so it doesn't restart the main service
    await run(`net stop "${WATCHDOG}"`);
    const r = await run(`net stop "${SERVICE}"`);
    log(r.ok ? `${SERVICE} stopped.` : `Failed to stop ${SERVICE}: ${r.err}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    switch (command) {
        case 'install':   await cmdInstall(installDir);   break;
        case 'uninstall': await cmdUninstall(installDir); break;
        case 'status':    await cmdStatus();               break;
        case 'start':     await cmdStart();                break;
        case 'stop':      await cmdStop();                 break;
        default:
            console.error('Usage: node service-setup.js <install|uninstall|status|start|stop> [installDir]');
            process.exit(1);
    }
}

main().catch(err => {
    console.error('[service-setup] Fatal error:', err.message);
    process.exit(1);
});
