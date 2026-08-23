import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/auth/argon2.js';

test('hashPassword produces a verifiable argon2id hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.match(hash, /^\$argon2id\$/);
    assert.equal(await verifyPassword(hash, 'correct horse battery staple'), true);
    assert.equal(await verifyPassword(hash, 'wrong password'), false);
});
