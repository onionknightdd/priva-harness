import type { DatabaseSync } from 'node:sqlite'

// Forward-only migrations keyed by position; PRAGMA user_version records how
// many have been applied. There is deliberately no downgrade path.
const MIGRATIONS: readonly ((db: DatabaseSync) => void)[] = [
  (db) => {
    db.exec(`
      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE audit_event (
        id          INTEGER PRIMARY KEY,
        ts_utc      TEXT NOT NULL,
        action      TEXT NOT NULL,
        session_id  TEXT,
        run_id      TEXT,
        target      TEXT,
        details     TEXT NOT NULL
      );
      CREATE INDEX audit_event_ts        ON audit_event(ts_utc);
      CREATE INDEX audit_event_action_ts ON audit_event(action, ts_utc);
      CREATE INDEX audit_event_session   ON audit_event(session_id, ts_utc);

      CREATE TABLE run_fact (
        id                 INTEGER PRIMARY KEY,
        run_id             TEXT NOT NULL,
        started_audit_id   INTEGER REFERENCES audit_event(id) ON DELETE SET NULL,
        finished_audit_id  INTEGER REFERENCES audit_event(id) ON DELETE SET NULL,
        started_utc        TEXT NOT NULL,
        finished_utc       TEXT,
        session_id         TEXT,
        provider           TEXT NOT NULL,
        profile_id         TEXT,
        model              TEXT NOT NULL,
        source             TEXT NOT NULL CHECK (source IN ('web', 'subagent-test', 'channel', 'scheduled')),
        prompt_chars       INTEGER NOT NULL,
        attachment_count   INTEGER NOT NULL,
        outcome            TEXT NOT NULL CHECK (outcome IN ('running', 'completed', 'failed', 'aborted')),
        failure_code       TEXT CHECK (failure_code IN (
                             'max_turns', 'max_budget', 'api_error', 'auth_error', 'compaction_failed',
                             'provider_error', 'transport_error', 'runtime_crash', 'unknown')),
        duration_ms        INTEGER,
        api_duration_ms    INTEGER,
        num_turns          INTEGER,
        input_tokens       INTEGER,
        output_tokens      INTEGER,
        cache_read_tokens  INTEGER,
        cache_write_tokens INTEGER,
        cost_usd           REAL
      );
      CREATE INDEX run_fact_started ON run_fact(started_utc);
      CREATE INDEX run_fact_run     ON run_fact(run_id);
      CREATE INDEX run_fact_session ON run_fact(session_id);

      CREATE TABLE run_model_usage (
        run_fact_id        INTEGER NOT NULL REFERENCES run_fact(id) ON DELETE CASCADE,
        model              TEXT NOT NULL,
        input_tokens       INTEGER NOT NULL,
        output_tokens      INTEGER NOT NULL,
        cache_read_tokens  INTEGER,
        cache_write_tokens INTEGER,
        cost_usd           REAL,
        PRIMARY KEY (run_fact_id, model)
      );

      CREATE TABLE tool_fact (
        id             INTEGER PRIMARY KEY,
        audit_id       INTEGER REFERENCES audit_event(id) ON DELETE SET NULL,
        run_id         TEXT NOT NULL,
        ts_utc         TEXT NOT NULL,
        tool_use_id    TEXT NOT NULL,
        tool_name      TEXT NOT NULL,
        mcp_server     TEXT,
        ok             INTEGER NOT NULL,
        duration_ms    INTEGER,
        output_tokens  INTEGER,
        agent_id       TEXT
      );
      CREATE INDEX tool_fact_ts   ON tool_fact(ts_utc);
      CREATE INDEX tool_fact_name ON tool_fact(tool_name, ts_utc);
    `)
  },
  // The working directory identifies a "project" in the usage overview. Rows
  // written before this column existed keep NULL and are not counted as one.
  (db) => {
    db.exec('ALTER TABLE run_fact ADD COLUMN cwd TEXT')
  },
]

export const SCHEMA_VERSION = MIGRATIONS.length

export function migrateSchema(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
  const current = row?.user_version ?? 0
  if (current > SCHEMA_VERSION) {
    throw new Error(`Data store schema version ${current} is newer than this runner supports (${SCHEMA_VERSION})`)
  }
  for (let version = current; version < SCHEMA_VERSION; version += 1) {
    const migration = MIGRATIONS[version]
    if (migration === undefined) break
    db.exec('BEGIN')
    try {
      migration(db)
      db.exec(`PRAGMA user_version = ${version + 1}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}
