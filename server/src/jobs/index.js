// The background job registry (#579). Add a job here and the scheduler runs
// it: { name, periodKey(now), run({ now, log }) }. Planned next: notification
// triggers (#211), which would call sendTemplatedEmail() (server/src/email/send.js).
import { netWorthSnapshotJob } from './netWorthSnapshot.js';
import { pruneSessionsJob } from './pruneSessions.js';

export const JOBS = [pruneSessionsJob, netWorthSnapshotJob];
