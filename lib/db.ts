import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export interface User {
  id: number;
  username: string;
  created_at: string;
  webauthn_user_id: string;
}

export interface Authenticator {
  id: number;
  user_id: number;
  credential_id: string;
  credential_public_key: Buffer;
  counter: number;
  created_at: string;
}

export interface Session {
  userId: number;
  username: string;
}

export type ChallengePurpose = 'registration' | 'authentication';

export interface AuthChallenge {
  username: string;
  purpose: ChallengePurpose;
  user_id: number | null;
  user_handle: string | null;
  challenge: string;
  expires_at: number;
}

let db: Database.Database | undefined;

function getDb(): Database.Database {
  if (db) {
    return db;
  }

  const dataDirectory = path.join(process.cwd(), 'data');
  mkdirSync(dataDirectory, { recursive: true });
  const databasePath = path.join(
    dataDirectory,
    path.basename(process.env.DATABASE_PATH ?? 'todos.db'),
  );
  const connection = new Database(databasePath);
  connection.pragma('foreign_keys = ON');
  connection.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      webauthn_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS authenticators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE,
      credential_public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_authenticators_user_id ON authenticators(user_id);

    CREATE TABLE IF NOT EXISTS auth_challenges (
      username TEXT NOT NULL COLLATE NOCASE,
      purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'authentication')),
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      user_handle TEXT,
      challenge TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (username, purpose)
    );
  `);

  const userColumns = connection.pragma('table_info(users)') as { name: string }[];
  if (!userColumns.some((column) => column.name === 'webauthn_user_id')) {
    connection.exec('ALTER TABLE users ADD COLUMN webauthn_user_id TEXT');
  }
  const challengeColumns = connection.pragma('table_info(auth_challenges)') as { name: string }[];
  if (!challengeColumns.some((column) => column.name === 'user_handle')) {
    connection.exec('ALTER TABLE auth_challenges ADD COLUMN user_handle TEXT');
  }
  const usersWithoutWebAuthnId = connection.prepare(
    'SELECT id FROM users WHERE webauthn_user_id IS NULL',
  ).all() as { id: number }[];
  const setWebAuthnUserId = connection.prepare(
    'UPDATE users SET webauthn_user_id = ? WHERE id = ?',
  );
  for (const user of usersWithoutWebAuthnId) {
    setWebAuthnUserId.run(randomBytes(32).toString('base64url'), user.id);
  }
  connection.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_webauthn_user_id ON users(webauthn_user_id)',
  );
  db = connection;
  return connection;
}

export const userDB = {
  findByUsername(username: string): User | undefined {
    return getDb().prepare(
      'SELECT id, username, created_at, webauthn_user_id FROM users WHERE username = ?',
    ).get(username) as User | undefined;
  },

  findById(id: number): User | undefined {
    return getDb().prepare(
      'SELECT id, username, created_at, webauthn_user_id FROM users WHERE id = ?',
    ).get(id) as User | undefined;
  },

  createWithAuthenticator(
    username: string,
    webauthnUserId: string,
    credentialId: string,
    credentialPublicKey: Buffer,
    counter: number,
  ): User {
    const database = getDb();
    const create = database.transaction(() => {
      const result = database.prepare(
        'INSERT INTO users (username, webauthn_user_id) VALUES (?, ?)',
      ).run(username, webauthnUserId);
      const userId = Number(result.lastInsertRowid);
      authenticatorDB.add(userId, credentialId, credentialPublicKey, counter);
      const user = userDB.findById(userId);
      if (!user) {
        throw new Error('Created user could not be read back');
      }
      return user;
    });

    return create();
  },
};

export const authenticatorDB = {
  findByCredentialId(credentialId: string): Authenticator | undefined {
    return getDb().prepare(
      `SELECT id, user_id, credential_id, credential_public_key, counter, created_at
       FROM authenticators WHERE credential_id = ?`,
    ).get(credentialId) as Authenticator | undefined;
  },

  findByUserId(userId: number): Authenticator[] {
    return getDb().prepare(
      `SELECT id, user_id, credential_id, credential_public_key, counter, created_at
       FROM authenticators WHERE user_id = ? ORDER BY id`,
    ).all(userId) as Authenticator[];
  },

  add(
    userId: number,
    credentialId: string,
    credentialPublicKey: Buffer,
    counter: number,
  ): void {
    getDb().prepare(
      `INSERT INTO authenticators
        (user_id, credential_id, credential_public_key, counter)
       VALUES (?, ?, ?, ?)`,
    ).run(userId, credentialId, credentialPublicKey, counter);
  },

  updateCounterIfUnchanged(
    id: number,
    previousCounter: number,
    newCounter: number,
  ): boolean {
    const result = getDb().prepare(
      'UPDATE authenticators SET counter = ? WHERE id = ? AND counter = ?',
    ).run(newCounter, id, previousCounter);
    return result.changes === 1;
  },
};

export const challengeStore = {
  save(
    username: string,
    purpose: ChallengePurpose,
    challenge: string,
    userId: number | null,
    userHandle: string | null,
    lifetimeMs: number,
  ): void {
    getDb().prepare(
      `INSERT INTO auth_challenges
        (username, purpose, challenge, user_id, user_handle, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(username, purpose) DO UPDATE SET
         challenge = excluded.challenge,
         user_id = excluded.user_id,
         user_handle = excluded.user_handle,
         expires_at = excluded.expires_at`,
    ).run(username, purpose, challenge, userId, userHandle, Date.now() + lifetimeMs);
  },

  consume(username: string, purpose: ChallengePurpose): AuthChallenge | undefined {
    const database = getDb();
    const consume = database.transaction(() => {
      const challenge = database.prepare(
        `SELECT username, purpose, user_id, user_handle, challenge, expires_at
         FROM auth_challenges WHERE username = ? AND purpose = ?`,
      ).get(username, purpose) as AuthChallenge | undefined;

      database.prepare(
        'DELETE FROM auth_challenges WHERE username = ? AND purpose = ?',
      ).run(username, purpose);

      if (!challenge || challenge.expires_at <= Date.now()) {
        return undefined;
      }
      return challenge;
    });

    return consume();
  },
};
