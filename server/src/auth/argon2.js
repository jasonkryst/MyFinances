import argon2 from 'argon2';

export function hashPassword(password) {
    return argon2.hash(password, { type: argon2.argon2id });
}

export function verifyPassword(hash, password) {
    return argon2.verify(hash, password);
}
