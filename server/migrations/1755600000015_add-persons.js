export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE persons (
            id BIGSERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX idx_persons_user_id ON persons(user_id);

        ALTER TABLE debts ADD COLUMN person_ids INTEGER[] NOT NULL DEFAULT '{}';
        ALTER TABLE incomes ADD COLUMN person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL;
    `);
}

export async function down(pgm) {
    pgm.sql(`
        ALTER TABLE incomes DROP COLUMN person_id;
        ALTER TABLE debts DROP COLUMN person_ids;
        DROP TABLE IF EXISTS persons;
    `);
}
