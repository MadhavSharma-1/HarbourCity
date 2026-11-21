import os

os.environ["NEON_DB_PATH"] = ":memory:"

import pytest
from fastapi.testclient import TestClient

from app import main
from app.providers import Provider, ProviderUnavailable
from app.schemas import DecisionRequest, DecisionResult, validate_decision


class FakeProvider(Provider):
    name = "fake"

    def __init__(self, answer):
        self.answer = answer
        self.last_user = None

    def complete_json(self, system, user, schema, max_tokens=2000):
        self.last_user = user
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


@pytest.fixture
def client():
    main._state.clear()
    return TestClient(main.app)


def use(answer):
    fp = FakeProvider(answer)
    main._state["provider"] = fp
    return fp


DIALOGUE = {
    "npc_id": "NPC_LENA", "name": "Lena Park", "occupation": "barista",
    "memories": [{"id": "m1", "summary": "Saw a black sports car speed past Corner Bean.", "minutes_ago": 10, "place": "Corner Bean"}],
    "player_line": "Hey, have you seen a black sports car around here?",
}


def test_dialogue_ok_and_grounded(client):
    fp = use({"reply": "Yeah, one flew past the café about ten minutes ago. Why?", "intent": "ask_back",
              "valence_delta": 0.0, "arousal_delta": 0.1, "affinity_delta": 0.02, "trust_delta": 0.0,
              "memory_to_store": {"summary": "The player asked about a black sports car.", "importance": 0.5, "tags": ["car", "black"]},
              "cited_memory_ids": ["m1", "invented-id"]})
    r = client.post("/v1/dialogue", json=DIALOGUE)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cited_memory_ids"] == ["m1"]          # hallucinated citation removed
    assert "Corner Bean" in fp.last_user                # the model only sees the NPC's own memories
    assert body["provider"] == "fake"


def test_dialogue_out_of_range_values_fall_back(client):
    use({"reply": "Sure.", "intent": "answer", "valence_delta": 3, "arousal_delta": 0, "affinity_delta": 0,
         "trust_delta": 0, "memory_to_store": None, "cited_memory_ids": []})
    r = client.post("/v1/dialogue", json=DIALOGUE)
    assert r.status_code == 503 and r.json()["detail"]["fallback"] is True


def test_dialogue_unknown_intent_falls_back(client):
    use({"reply": "ok", "intent": "delete_save_files", "valence_delta": 0, "arousal_delta": 0, "affinity_delta": 0,
         "trust_delta": 0, "memory_to_store": None, "cited_memory_ids": []})
    assert client.post("/v1/dialogue", json=DIALOGUE).status_code == 503


def test_provider_down_falls_back(client):
    use(ProviderUnavailable("offline"))
    r = client.post("/v1/dialogue", json=DIALOGUE)
    assert r.status_code == 503 and r.json()["detail"]["reason"] == "offline"


def test_decision_must_be_allowed(client):
    use({"decision": "teleport_to_moon", "priority": 0.9, "reason": "why not", "next_action": "fly"})
    r = client.post("/v1/decide", json={"npc_id": "NPC_DANIEL", "name": "Daniel", "current_goal": "go_to_work",
                                        "observed_event": "traffic_accident", "allowed_actions": ["investigate", "flee", "ignore"]})
    assert r.status_code == 200
    assert r.json()["accepted"] is False and r.json()["decision"] == "keep_current_goal"


def test_decision_accepted(client):
    use({"decision": "Investigate", "priority": 0.72, "reason": "Accident occurred nearby", "next_action": "move_to_safe_observation_point"})
    r = client.post("/v1/decide", json={"npc_id": "NPC_000421", "name": "Daniel", "current_goal": "go_to_work",
                                        "observed_event": "traffic_accident", "allowed_actions": ["investigate", "flee", "ignore"]})
    body = r.json()
    assert body["accepted"] is True and body["decision"] == "investigate" and body["priority"] == 0.72


def test_memory_sync_roundtrip(client):
    rec = {"memory_id": "g1", "npc_id": "NPC_LENA", "tier": "Episodic", "event_type": "VehicleCrash",
           "summary": "A black sports car hit a parked hatchback.", "tags": ["crash", "black"], "game_time": 31.5,
           "confidence": 0.9, "importance": 0.8, "source": "Observed"}
    assert client.post("/v1/memory/sync", json={"memories": [rec, rec]}).json()["stored"] == 2
    mem = client.get("/v1/memory/NPC_LENA").json()["memories"]
    assert len(mem) == 1 and mem[0]["event_type"] == "VehicleCrash"


def test_validate_decision_unit():
    req = DecisionRequest(npc_id="x", name="x", current_goal="g", allowed_actions=["flee"])
    res, ok = validate_decision(DecisionResult(decision=" FLEE "), req)
    assert ok and res.decision == "flee"
