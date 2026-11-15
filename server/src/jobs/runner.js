// In-process background job runner (#579).
//
// A job is { name, periodKey(now) -> string, run({ now, log }) -> result }.
// Every tick asks each job for the current period key and tries to claim
// (job_name, period_key) in job_runs. The unique key makes the claim atomic,
// so a job runs once per period across restarts and across several server
// processes sharing one database.
//
// Retry policy: a run that throws is recorded as 'failed' with its error, and
// the next tick in the same period may claim it again, up to MAX_ATTEMPTS
// tries per period. A 'running' row older than STALE_RUN_MINUTES (a process
// that died mid-run) can also be reclaimed. Jobs must therefore be idempotent.
//
// Nothing here starts on import: only server/src/index.js calls
// startJobScheduler(), so tests that import createApp() never run jobs.

import { query } from '../db.js';

export const MAX_ATTEMPTS = 5;
export const STALE_RUN_MINUTES = 60;
export const TICK_INTERVAL_MS = 60 * 60 * 1000;
export const INITIAL_DELAY_MS = 30 * 1000;
const MAX_ERROR_LENGTH = 2000;

// JOBS_ENABLED is on unless set to false/0/no/off (any case).
export function jobsEnabled(env = process.env) {
    const raw = env.JOBS_ENABLED;
    if (raw === undefined || raw === null || String(raw).trim() === '') return true;
    return !['false', '0', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

// Claims (jobName, periodKey). Returns the run id, or null when another run
// owns the period (succeeded, still running, or out of attempts).
export async function claimRun(jobName, periodKey) {
    const { rows } = await query(
        `INSERT INTO job_runs (job_name, period_key) VALUES ($1, $2)
         ON CONFLICT (job_name, period_key) DO UPDATE
            SET status = 'running', attempts = job_runs.attempts + 1,
                started_at = now(), finished_at = NULL, error = NULL, result = NULL
          WHERE job_runs.attempts < $3
            AND (job_runs.status = 'failed'
                 OR (job_runs.status = 'running' AND job_runs.started_at < now() - make_interval(mins => $4)))
         RETURNING id`,
        [jobName, periodKey, MAX_ATTEMPTS, STALE_RUN_MINUTES]
    );
    return rows.length ? rows[0].id : null;
}

async function finishRun(id, status, { error = null, result = null } = {}) {
    await query(
        `UPDATE job_runs SET status = $2, finished_at = now(), error = $3, result = $4 WHERE id = $1`,
        [id, status, error, result === null || result === undefined ? null : JSON.stringify(result)]
    );
}

// Runs one job for the period containing `now`, if it can claim it. Never
// throws: a failure is logged and recorded. Returns
// { status: 'skipped' | 'succeeded' | 'failed', periodKey, result?, error? }.
export async function runJob(job, now = new Date(), log = console) {
    let periodKey;
    let runId = null;
    try {
        periodKey = job.periodKey(now);
        runId = await claimRun(job.name, periodKey);
        if (runId === null) return { status: 'skipped', periodKey };
        const result = await job.run({ now, log });
        await finishRun(runId, 'succeeded', { result: result ?? null });
        log.log(`[jobs] ${job.name} ${periodKey} succeeded`);
        return { status: 'succeeded', periodKey, result };
    } catch (err) {
        const message = String(err?.stack || err?.message || err).slice(0, MAX_ERROR_LENGTH);
        log.error(`[jobs] ${job.name} ${periodKey ?? '?'} failed:`, err);
        if (runId !== null) {
            try {
                await finishRun(runId, 'failed', { error: message });
            } catch (recordErr) {
                log.error(`[jobs] could not record the failure of ${job.name}:`, recordErr);
            }
        }
        return { status: 'failed', periodKey, error: message };
    }
}

// Runs every job in order (one at a time, so a slow job never overlaps itself).
export async function runDueJobs(jobs, now = new Date(), log = console) {
    const outcomes = {};
    for (const job of jobs) {
        outcomes[job.name] = await runJob(job, now, log);
    }
    return outcomes;
}

// Starts the scheduler: one tick shortly after startup, then every
// `intervalMs`. Returns { stop } or null when JOBS_ENABLED=false.
export function startJobScheduler({
    jobs,
    env = process.env,
    intervalMs = TICK_INTERVAL_MS,
    initialDelayMs = INITIAL_DELAY_MS,
    log = console,
} = {}) {
    if (!jobsEnabled(env)) {
        log.log('[jobs] background jobs disabled (JOBS_ENABLED=false)');
        return null;
    }
    let ticking = false;
    const tick = async () => {
        if (ticking) return;
        ticking = true;
        try {
            await runDueJobs(jobs, new Date(), log);
        } catch (err) {
            log.error('[jobs] tick failed:', err);
        } finally {
            ticking = false;
        }
    };
    const startTimer = setTimeout(tick, initialDelayMs);
    const interval = setInterval(tick, intervalMs);
    startTimer.unref?.();
    interval.unref?.();
    log.log(`[jobs] scheduler started: ${jobs.map(j => j.name).join(', ')}`);
    return {
        stop() {
            clearTimeout(startTimer);
            clearInterval(interval);
        },
    };
}
