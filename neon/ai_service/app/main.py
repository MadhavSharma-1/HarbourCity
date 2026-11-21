"""Project Neon AI orchestration service.

Run:  uvicorn app.main:app --port 8787
The game talks to this over localhost. It never executes game commands: it returns
proposals in a fixed schema, and the game validates them against its own rules.
"""
from __future__ import annotations

import json
import os
import threading

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

from .db import Store
from .providers import DECISION_SYSTEM, DIALOGUE_SYSTEM, Provider, ProviderUnavailable, make_provider
from .schemas import (
    DECISION_JSON_SCHEMA, DIALOGUE_JSON_SCHEMA, DecisionRequest, DecisionResponse, DecisionResult,
    DialogueRequest, DialogueResponse, DialogueResult, MemorySync, ground_dialogue, validate_decision,
)

app = FastAPI(title="Project Neon AI service", version="0.1.0")
_state: dict = {}
# a small budget so a busy city can't flood the model: excess requests fall back to game rules
_inflight = threading.BoundedSemaphore(int(os.getenv("NEON_MAX_CONCURRENT", "4")))


def provider() -> Provider:
    if "provider" not in _state:
        _state["provider"] = make_provider()
    return _state["provider"]


def store() -> Store:
    if "store" not in _state:
        _state["store"] = Store(os.getenv("NEON_DB_PATH", "neon_memory.db"))
    return _state["store"]


def _fallback(reason: str) -> HTTPException:
    # 503 + fallback flag tells the game to use its local, rule-based behaviour
    return HTTPException(status_code=503, detail={"fallback": True, "reason": reason})


@app.get("/health")
def health():
    return {"ok": True, "provider": provider().name}


def dialogue_user_message(req: DialogueRequest) -> str:
    character = {
        "name": req.name, "age": req.age, "occupation": req.occupation, "employer": req.employer,
        "employed": req.employed, "backstory": req.backstory,
        "personality": req.personality.model_dump(), "emotion": req.emotion.model_dump(),
        "doing_right_now": req.current_activity, "where": req.location, "time": req.game_clock,
        "weather": req.weather, "relationship_with_player": req.relationship_with_player.model_dump(),
        "what_the_player_looks_like": req.player_appearance,
    }
    memories = [m.model_dump() for m in req.memories]
    history = [f"{t.speaker}: {t.text}" for t in req.history]
    return (
        f"CHARACTER\n{json.dumps(character, ensure_ascii=False)}\n\n"
        f"MEMORIES (the only events this character knows about)\n{json.dumps(memories, ensure_ascii=False)}\n\n"
        f"KNOWN PLACES\n{json.dumps(req.known_places, ensure_ascii=False)}\n\n"
        f"CONVERSATION SO FAR\n" + ("\n".join(history) or "(none)") + "\n\n"
        f"THE PLAYER NOW SAYS\n{req.player_line}"
    )


@app.post("/v1/dialogue", response_model=DialogueResponse)
def dialogue(req: DialogueRequest):
    p = provider()
    if not _inflight.acquire(blocking=False):
        raise _fallback("busy")
    try:
        raw = p.complete_json(DIALOGUE_SYSTEM, dialogue_user_message(req), DIALOGUE_JSON_SCHEMA, max_tokens=1500)
        result = ground_dialogue(DialogueResult.model_validate(raw), req)
    except ProviderUnavailable as e:
        raise _fallback(str(e))
    except ValidationError as e:
        raise _fallback(f"model output failed validation: {e.error_count()} errors")
    finally:
        _inflight.release()
    store().log_dialogue(req.npc_id, 0.0, req.player_line, result.reply, result.intent.value, p.name, result.cited_memory_ids)
    return DialogueResponse(npc_id=req.npc_id, provider=p.name, **result.model_dump())


@app.post("/v1/decide", response_model=DecisionResponse)
def decide(req: DecisionRequest):
    p = provider()
    if not _inflight.acquire(blocking=False):
        raise _fallback("busy")
    try:
        user = json.dumps(req.model_dump(), ensure_ascii=False)
        raw = p.complete_json(DECISION_SYSTEM, user, DECISION_JSON_SCHEMA, max_tokens=600)
        result, accepted = validate_decision(DecisionResult.model_validate(raw), req)
    except ProviderUnavailable as e:
        raise _fallback(str(e))
    except ValidationError as e:
        raise _fallback(f"model output failed validation: {e.error_count()} errors")
    finally:
        _inflight.release()
    store().log_decision(req.npc_id, 0.0, req.observed_event, result.decision, accepted, result.reason)
    return DecisionResponse(npc_id=req.npc_id, current_goal=req.current_goal, observed_event=req.observed_event,
                            accepted=accepted, provider=p.name, **result.model_dump())


@app.post("/v1/memory/sync")
def memory_sync(body: MemorySync):
    return {"stored": store().upsert_memories(body.memories)}


@app.get("/v1/memory/{npc_id}")
def memory_list(npc_id: str, limit: int = 50):
    return {"npc_id": npc_id, "memories": store().memories_for(npc_id, min(limit, 500))}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("NEON_PORT", "8787")))
