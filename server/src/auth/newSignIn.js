import { query } from '../db.js';
import { deviceKey, summarizeUserAgent } from './sessionInfo.js';
import { isEmailConfigured } from '../email/transport.js';
import { sendTemplatedEmail } from '../email/send.js';
import { getNotificationPrefs } from '../../../src/notificationsCore.js';
import { NOTIFY_NEW_SIGN_IN, NOTIFY_CHANNEL } from '../../../src/settingsSchema.js';

// #683: remembers the browser/OS pair of every sign-in (known_devices) and,
// when the pair is new for an account that already had one, emails the user.
// The very first device is remembered silently. The email honours the
// notifyNewSignIn setting (on by default) and notifyChannel ('inApp' means no
// email), and is sent in the background: a slow or failing SMTP server never
// delays or fails the sign-in.
//
// Resolves to { isNew, emailed } where `emailed` is a promise of whether an
// email went out (tests await it; login does not).
export async function recordSignIn(userId, email, meta = {}) {
    const key = deviceKey(meta.userAgent);
    const { rows } = await query(
        `WITH prior AS (SELECT count(*)::int AS n FROM known_devices WHERE user_id = $1),
              ins AS (
                INSERT INTO known_devices (user_id, device_key) VALUES ($1, $2)
                ON CONFLICT (user_id, device_key) DO UPDATE SET last_seen_at = now()
                RETURNING (xmax = 0) AS inserted
              )
         SELECT ins.inserted, prior.n FROM ins, prior`,
        [userId, key]
    );
    const isNew = Boolean(rows[0]?.inserted) && rows[0].n > 0;
    const emailed = isNew ? sendNewSignInEmail(userId, email, meta) : Promise.resolve(false);
    emailed.catch(() => {});
    return { isNew, emailed };
}

async function sendNewSignInEmail(userId, email, meta) {
    try {
        if (!isEmailConfigured() || !email) return false;
        const { rows } = await query(
            'SELECT key, value FROM settings WHERE user_id = $1 AND key = ANY($2::text[])',
            [userId, [NOTIFY_NEW_SIGN_IN, NOTIFY_CHANNEL]]
        );
        const prefs = getNotificationPrefs(rows);
        if (!prefs.newSignIn || prefs.channel === 'inApp') return false;
        const { browser, os } = summarizeUserAgent(meta.userAgent);
        const device = `${browser || 'Unknown browser'} on ${os || 'unknown OS'}`;
        await sendTemplatedEmail(email, 'newSignInEmail', {
            device, ip: meta.ipPrefix || '', when: new Date().toUTCString()
        });
        return true;
    } catch (err) {
        console.error('[auth] new sign-in email failed:', err);
        return false;
    }
}
