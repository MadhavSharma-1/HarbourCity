"""SQLite persistence for NPC memory mirrors and AI audit logs."""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

from .schemas import MemoryRecord

_SCHEMA = (Path(__file__).parent / "schema.sql").read_text()


class Store:
    def __init__(self, path: str):
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.executescript(_SCHEMA)
        self._db.commit()

    def upsert_memories(self, records: list[MemoryRecord]) -> int:
        rows = [(
            r.memory_id, r.npc_id, r.tier, r.event_type, r.summary, " ".join(r.tags), r.game_time,
            r.location[0], r.location[1], r.location[2], r.place, ",".join(r.participants),
            r.confidence, r.importance, r.source, r.source_npc, r.valence, r.arousal, r.expires_at,
        ) for r in records]
        with self._lock:
            self._db.executemany(
                """INSERT INTO npc_memory (memory_id, npc_id, tier, event_type, summary, tags, game_time,
                       loc_x, loc_y, loc_z, place, participants, confidence, importance, source, source_npc,
                       valence, arousal, expires_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(memory_id) DO UPDATE SET tier=excluded.tier, summary=excluded.summary,
                       confidence=excluded.confidence, importance=excluded.importance,
                       expires_at=excluded.expires_at, synced_at=datetime('now')""", rows)
            self._db.commit()
        return len(rows)

    def memories_for(self, npc_id: str, limit: int = 50) -> list[dict]:
        with self._lock:
            cur = self._db.execute(
                "SELECT memory_id, tier, event_type, summary, game_time, importance, source FROM npc_memory "
                "WHERE npc_id=? ORDER BY game_time DESC LIMIT ?", (npc_id, limit))
            cols = [c[0] for c in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]

    def log_dialogue(self, npc_id: str, game_time: float, player: str, reply: str, intent: str, provider: str, cited: list[str]):
        with self._lock:
            self._db.execute(
                "INSERT INTO dialogue_log (npc_id, game_time, player_line, npc_reply, intent, provider, cited_memories) VALUES (?,?,?,?,?,?,?)",
                (npc_id, game_time, player, reply, intent, provider, ",".join(cited)))
            self._db.commit()

    def log_decision(self, npc_id: str, game_time: float, event: str, decision: str, accepted: bool, reason: str):
        with self._lock:
            self._db.execute(
                "INSERT INTO decision_log (npc_id, game_time, observed_event, decision, accepted, reason) VALUES (?,?,?,?,?,?)",
                (npc_id, game_time, event, decision, int(accepted), reason))
            self._db.commit()
