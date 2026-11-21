-- NPC memory store (mirrors the game's save file so memories can be inspected, queried and analysed)
CREATE TABLE IF NOT EXISTS npc_memory (
    memory_id      TEXT PRIMARY KEY,           -- GUID created by the game
    npc_id         TEXT NOT NULL,              -- e.g. NPC_DANIEL
    tier           TEXT NOT NULL CHECK (tier IN ('Working', 'Episodic', 'Semantic')),
    event_type     TEXT NOT NULL,              -- VehicleCrash, Conversation, JobLost, ...
    summary        TEXT NOT NULL,
    tags           TEXT NOT NULL DEFAULT '',   -- space separated keywords used for retrieval
    game_time      REAL NOT NULL,              -- game hours since day 0, 00:00
    loc_x REAL, loc_y REAL, loc_z REAL,
    place          TEXT,
    participants   TEXT NOT NULL DEFAULT '',   -- comma separated ids (PLAYER, NPC_LENA, ...)
    confidence     REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    importance     REAL NOT NULL CHECK (importance BETWEEN 0 AND 1),
    source         TEXT NOT NULL,              -- Observed, Heard, ToldBy, Conversation, Self
    source_npc     TEXT,                       -- who told them, for ToldBy
    valence        REAL NOT NULL DEFAULT 0,    -- emotional state when stored (-1..1)
    arousal        REAL NOT NULL DEFAULT 0,    -- (0..1)
    expires_at     REAL NOT NULL DEFAULT -1,   -- game hours; -1 = keep
    synced_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_npc ON npc_memory (npc_id, importance DESC);
CREATE INDEX IF NOT EXISTS idx_memory_event ON npc_memory (event_type);

CREATE TABLE IF NOT EXISTS dialogue_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    npc_id         TEXT NOT NULL,
    game_time      REAL NOT NULL,
    player_line    TEXT NOT NULL,
    npc_reply      TEXT NOT NULL,
    intent         TEXT NOT NULL,
    provider       TEXT NOT NULL,
    cited_memories TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS decision_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    npc_id         TEXT NOT NULL,
    game_time      REAL NOT NULL,
    observed_event TEXT,
    decision       TEXT NOT NULL,
    accepted       INTEGER NOT NULL,           -- 1 if it passed validation
    reason         TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
