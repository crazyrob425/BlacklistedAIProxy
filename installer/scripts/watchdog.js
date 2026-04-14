/**
 * BlacklistedAIProxy Self-Healing Watchdog Service
 *
 * This script runs as a Windows service (via NSSM) and continuously monitors
 * the main BlacklistedAIProxy service. If the service stops or crashes, the
 * watchdog automatically restarts it.
 *
 * Resource usage: minimal — one setInterval with sc.exe query every 30 seconds.
 */

import { exec } from 'child_process';
import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ─────────────────────────────────────────────────────────────

const SERVICE_NAME      = 'BlacklistedAIProxy';
const CHECK_INTERVAL_MS = parseInt(process.env.BAP_WATCHDOG_INTERVAL_MS || '30000', 10);
const RESTART_DELAY_MS  = 5_000;    // wait 5 s before restarting
const MAX_RETRIES       = 5;        // max restart attempts in one window
const RETRY_WINDOW_MS   = 300_000;  // 5-minute rolling window for retries
const LOG_DIR           = join(__dirname, 'logs');
const LOG_FILE          = join(LOG_DIR, 'watchdog.log');

// ── Logging ───────────────────────────────────────────────────────────────────

if (!existsSync(LOG_DIR)) {
    try { mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { process.stderr.write(`[Watchdog] Could not create log directory: ${e.message}\n`); }
}

const logStream = existsSync(LOG_DIR)
    ? createWriteStream(LOG_FILE, { flags: 'a' })
    : null;

function log(level, message) {
    const ts  = new Date().toISOString();
    const line = `[${ts}] [${level}] [Watchdog] ${message}\n`;
    process.stdout.write(line);
    if (logStream) logStream.write(line);
}

// ── Retry tracking ────────────────────────────────────────────────────────────

const restartTimestamps = [];

function recentRestartCount() {
    const cutoff = Date.now() - RETRY_WINDOW_MS;
    // remove stale entries
    while (restartTimestamps.length && restartTimestamps[0] < cutoff) {
        restartTimestamps.shift();
    }
    return restartTimestamps.length;
}

function recordRestart() {
    restartTimestamps.push(Date.now());
}

// ── Service control ───────────────────────────────────────────────────────────

function queryService(name) {
    return new Promise((resolve) => {
        exec(`sc query "${name}"`, (err, stdout) => {
            if (err || !stdout) { resolve('UNKNOWN'); return; }
            const m = stdout.match(/STATE\s+:\s+\d+\s+(\S+)/);
            resolve(m ? m[1].toUpperCase() : 'UNKNOWN');
        });
    });
}

function startService(name) {
    return new Promise((resolve, reject) => {
        exec(`net start "${name}"`, (err, stdout, stderr) => {
            if (err) {
                reject(new Error((stderr || err.message).trim()));
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

// ── Main watchdog loop ────────────────────────────────────────────────────────

let isChecking = false;

async function runCheck() {
    if (isChecking) return;
    isChecking = true;

    try {
        const state = await queryService(SERVICE_NAME);

        if (state === 'RUNNING') {
            log('DEBUG', `${SERVICE_NAME} is RUNNING — OK`);
        } else {
            log('WARN', `${SERVICE_NAME} state: ${state} — initiating recovery`);

            const recent = recentRestartCount();
            if (recent >= MAX_RETRIES) {
                log('ERROR',
                    `${SERVICE_NAME} has been restarted ${recent} times in the last ` +
                    `${RETRY_WINDOW_MS / 60_000} minutes — backing off to prevent restart loop.`);
                return;
            }

            await new Promise(r => setTimeout(r, RESTART_DELAY_MS));

            try {
                await startService(SERVICE_NAME);
                recordRestart();
                log('INFO', `${SERVICE_NAME} successfully restarted (attempt ${recent + 1}/${MAX_RETRIES})`);
            } catch (err) {
                log('ERROR', `Failed to restart ${SERVICE_NAME}: ${err.message}`);
            }
        }
    } catch (err) {
        log('ERROR', `Check failed with unexpected error: ${err.message}`);
    } finally {
        isChecking = false;
    }
}

// ── Startup ───────────────────────────────────────────────────────────────────

log('INFO', `Watchdog started — monitoring "${SERVICE_NAME}" every ${CHECK_INTERVAL_MS / 1000}s`);
log('INFO', `Max ${MAX_RETRIES} restarts per ${RETRY_WINDOW_MS / 60_000}-minute window`);

// Run immediately at startup then on interval
runCheck();
setInterval(runCheck, CHECK_INTERVAL_MS);

// ── Graceful shutdown ─────────────────────────────────────────────────────────

process.on('SIGTERM', () => {
    log('INFO', 'Watchdog received SIGTERM — shutting down gracefully');
    if (logStream) logStream.end();
    process.exit(0);
});
process.on('SIGINT', () => {
    log('INFO', 'Watchdog received SIGINT — shutting down gracefully');
    if (logStream) logStream.end();
    process.exit(0);
});
