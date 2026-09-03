import nodemailer from 'nodemailer';

let transporter = null;
let transportOverride = null;

function buildTransporter() {
    const auth = process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined;
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth
    });
}

export function isEmailConfigured() {
    return Boolean(process.env.SMTP_HOST);
}

export function getTransport() {
    if (transportOverride) return transportOverride;
    if (!transporter) transporter = buildTransporter();
    return transporter;
}

// Test-only: swaps in a fake/no-network transport (e.g. nodemailer's
// jsonTransport, or a hand-rolled recording object) so tests never touch
// the network. Never called from application code.
export function _setTransportOverride(transport) {
    transportOverride = transport;
}

export function _clearTransportOverride() {
    transportOverride = null;
    transporter = null;
}
