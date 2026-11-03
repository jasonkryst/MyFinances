import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    validatePasswordPolicy, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH
} from '../../../src/passwordPolicy.js';
import { isPasswordBreached, isBreachCheckEnabled } from './breachedPasswords.js';

export { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH };

// SecLists Passwords/Common-Credentials/10k-most-common.txt (MIT), bundled
// unmodified; see docs/third-party-notices.md. Loaded once, lowercased.
const LIST_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/common-passwords.txt');
let commonPasswords = null;
export function getCommonPasswords() {
    if (!commonPasswords) {
        commonPasswords = new Set(
            readFileSync(LIST_PATH, 'utf8').split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean)
        );
    }
    return commonPasswords;
}

// English fallbacks only. The browser shows its own en/es/pl text keyed on
// `reason` (src/passwordUi.js), so these are for API/CLI callers.
const MESSAGES = {
    PASSWORD_TOO_SHORT: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    PASSWORD_TOO_LONG: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
    PASSWORD_REPETITIVE: 'Password is too repetitive or sequential.',
    PASSWORD_COMMON: 'Password is too common.',
    PASSWORD_CONTEXT: 'Password must not contain your email name or the app name.',
    PASSWORD_BREACHED: 'This password has appeared in a known data breach. Choose a different one.'
};

export function passwordPolicySummary() {
    return {
        minLength: PASSWORD_MIN_LENGTH,
        maxLength: PASSWORD_MAX_LENGTH,
        breachedCheckEnabled: isBreachCheckEnabled()
    };
}

// Runs the local rules first and the (network) breach check last. Returns
// null when the password is acceptable, else { reason, message }.
export async function checkNewPassword(password, { email = '' } = {}) {
    const reason = validatePasswordPolicy(password, { email, commonPasswords: getCommonPasswords() });
    if (reason) return { reason, message: MESSAGES[reason] };
    if (await isPasswordBreached(password)) return { reason: 'PASSWORD_BREACHED', message: MESSAGES.PASSWORD_BREACHED };
    return null;
}

export function passwordProblemResponse(res, problem) {
    return res.status(400).json({
        error: { code: 'VALIDATION_FAILED', reason: problem.reason, message: problem.message }
    });
}
