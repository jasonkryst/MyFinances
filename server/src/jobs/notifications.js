// Notifications job (#211). Hourly: for every user, compute the bill-due and
// balance alerts that are due (src/notificationsCore.js, the same projection
// the browser shows), store the new ones, resolve balance episodes that are
// over, and email what is pending.
//
// Idempotent by construction: each alert has a unique (user_id, dedupe_key),
// so a retried or repeated check inserts nothing twice, and a balance alert is
// skipped while an earlier one for the same account and type is still open.
// A failed email never fails the job: the row stays 'pending' and is retried
// on later runs, up to MAX_EMAIL_ATTEMPTS, within EMAIL_RETRY_HOURS.

import { query } from '../db.js';
import { computeNotificationEvents, getNotificationPrefs } from '../../../src/notificationsCore.js';
import { withProjectionCache } from '../../../src/projectionCache.js';
import { isEmailConfigured } from '../email/transport.js';
import { sendTemplatedEmail } from '../email/send.js';
import { loadUserState } from './loadUserState.js';
import { hourPeriodKey } from './periods.js';

export const MAX_EMAIL_ATTEMPTS = 3;
export const EMAIL_RETRY_HOURS = 48;

async function insertEvent(userId, event, { showInApp, emailOn }) {
    const { rowCount } = await query(
        `INSERT INTO notifications (user_id, type, dedupe_key, episode_key, params, show_in_app, email_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
        [userId, event.type, event.dedupeKey, event.episodeKey, JSON.stringify(event.params || {}),
            showInApp, emailOn ? 'pending' : 'none']
    );
    return rowCount;
}

// Sends this user's pending emails: one per alert, or one digest. Returns
// { sent, failed } counts of alerts (not messages).
export async function sendPendingEmails(userId, delivery, log = console) {
    await query(
        `UPDATE notifications SET email_status = 'failed'
          WHERE user_id = $1 AND email_status = 'pending'
            AND created_at < now() - make_interval(hours => $2)`,
        [userId, EMAIL_RETRY_HOURS]
    );
    const { rows } = await query(
        `SELECT id, type, params FROM notifications
          WHERE user_id = $1 AND email_status = 'pending' AND email_attempts < $2
          ORDER BY created_at, id`,
        [userId, MAX_EMAIL_ATTEMPTS]
    );
    if (rows.length === 0) return { sent: 0, failed: 0 };
    const { rows: users } = await query('SELECT email FROM users WHERE id = $1', [userId]);
    if (!users.length) return { sent: 0, failed: 0 };
    const to = users[0].email;

    const batches = delivery === 'digest' ? [rows] : rows.map(r => [r]);
    let sent = 0;
    let failed = 0;
    for (const batch of batches) {
        const ids = batch.map(r => r.id);
        try {
            await sendTemplatedEmail(to, 'notificationEmail', { items: batch.map(r => ({ type: r.type, params: r.params })) });
            await query(
                `UPDATE notifications SET email_status = 'sent', email_attempts = email_attempts + 1 WHERE id = ANY($1::bigint[])`,
                [ids]
            );
            sent += batch.length;
        } catch (err) {
            log.error(`[jobs] notification email failed for user ${userId}:`, err?.message || err);
            await query(
                `UPDATE notifications
                    SET email_attempts = email_attempts + 1,
                        email_status = CASE WHEN email_attempts + 1 >= $2 THEN 'failed' ELSE 'pending' END
                  WHERE id = ANY($1::bigint[])`,
                [ids, MAX_EMAIL_ATTEMPTS]
            );
            failed += batch.length;
        }
    }
    return { sent, failed };
}

// One user's check. Returns { created, resolved, sent, failed }.
export async function checkNotificationsForUser(userId, now = new Date(), log = console) {
    const app = await loadUserState(userId);
    const prefs = getNotificationPrefs(app.settings);
    const { events, activeEpisodes } = withProjectionCache(app, () => computeNotificationEvents(app, now, prefs));
    const emailOn = prefs.channel !== 'inApp' && isEmailConfigured();
    const showInApp = prefs.channel !== 'email';

    const { rows: openRows } = await query(
        `SELECT episode_key FROM notifications
          WHERE user_id = $1 AND episode_key IS NOT NULL AND resolved_at IS NULL`,
        [userId]
    );
    const open = new Set(openRows.map(r => r.episode_key));

    let created = 0;
    for (const event of events) {
        if (event.episodeKey && open.has(event.episodeKey)) continue;
        created += await insertEvent(userId, event, { showInApp, emailOn });
    }

    const { rowCount: resolved } = await query(
        `UPDATE notifications SET resolved_at = now()
          WHERE user_id = $1 AND episode_key IS NOT NULL AND resolved_at IS NULL
            AND NOT (episode_key = ANY($2::text[]))`,
        [userId, activeEpisodes]
    );

    const emails = emailOn ? await sendPendingEmails(userId, prefs.delivery, log) : { sent: 0, failed: 0 };
    return { created, resolved, ...emails };
}

export const notificationsJob = {
    name: 'notifications',
    periodKey: hourPeriodKey,
    async run({ now = new Date(), log = console } = {}) {
        const { rows } = await query('SELECT id FROM users ORDER BY id');
        const totals = { users: 0, created: 0, resolved: 0, sent: 0, failed: 0 };
        const errors = [];
        // One user's failure must not stop the others; the period is then
        // marked failed and retried, which is safe (see the header).
        for (const { id } of rows) {
            try {
                const r = await checkNotificationsForUser(id, now, log);
                totals.users++;
                for (const k of ['created', 'resolved', 'sent', 'failed']) totals[k] += r[k];
            } catch (err) {
                errors.push(`user ${id}: ${err?.message || err}`);
                log.error(`[jobs] notifications failed for user ${id}:`, err);
            }
        }
        if (errors.length) throw new Error(`notifications failed for ${errors.length} user(s): ${errors.join('; ')}`);
        return totals;
    },
};
