import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import {
    isEmailConfigured,
    getTransport,
    _setTransportOverride,
    _clearTransportOverride
} from '../src/email/transport.js';

let originalHost;

beforeEach(() => {
    originalHost = process.env.SMTP_HOST;
});

afterEach(() => {
    if (originalHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = originalHost;
    _clearTransportOverride();
});

test('isEmailConfigured is false when SMTP_HOST is unset', () => {
    delete process.env.SMTP_HOST;
    assert.equal(isEmailConfigured(), false);
});

test('isEmailConfigured is true when SMTP_HOST is set', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    assert.equal(isEmailConfigured(), true);
});

test('getTransport builds a real transporter with sendMail when no override is set', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    const transport = getTransport();
    assert.equal(typeof transport.sendMail, 'function');
});

test('getTransport returns the override once one is set, and stops once cleared', () => {
    const fake = nodemailer.createTransport({ jsonTransport: true });
    _setTransportOverride(fake);
    assert.equal(getTransport(), fake);
    _clearTransportOverride();
    assert.notEqual(getTransport(), fake);
});
