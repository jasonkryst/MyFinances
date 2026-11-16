// The background job registry (#579). Add a job here and the scheduler runs
// it: { name, periodKey(now), run({ now, log }) }.
import { netWorthSnapshotJob } from './netWorthSnapshot.js';
import { notificationsJob } from './notifications.js';
import { pruneSessionsJob } from './pruneSessions.js';

export const JOBS = [pruneSessionsJob, netWorthSnapshotJob, notificationsJob];
