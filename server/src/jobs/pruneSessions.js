// Hourly housekeeping (#536, #579): delete expired sessions (until now they
// were only removed when presented, on logout or on a password change) and
// job_runs rows that finished more than JOB_RUN_RETENTION_DAYS ago.

import { query } from '../db.js';
import { hourPeriodKey } from './periods.js';

export const JOB_RUN_RETENTION_DAYS = 90;

export async function pruneExpiredSessions() {
    // sessions_expires_at_idx (migration 1755600000012) keeps this cheap.
    const { rowCount } = await query('DELETE FROM sessions WHERE expires_at < now()');
    return rowCount;
}

export const pruneSessionsJob = {
    name: 'prune-sessions',
    periodKey: hourPeriodKey,
    async run() {
        const sessionsDeleted = await pruneExpiredSessions();
        const { rowCount: jobRunsDeleted } = await query(
            'DELETE FROM job_runs WHERE finished_at < now() - make_interval(days => $1)',
            [JOB_RUN_RETENTION_DAYS]
        );
        return { sessionsDeleted, jobRunsDeleted };
    },
};
