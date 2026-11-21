"""Request/response contracts between the game and the AI service.

The game sends only what the NPC actually knows (retrieved memories, relationship,
mood). The model's answer must fit a small schema; anything outside it is rejected
and the game falls back to its own rule-based behaviour.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


# ───────────────────────────── shared pieces ─────────────────────────────
class Personality(BaseModel):
    friendliness: float = Field(0.5, ge=0, le=1)
    aggression: float = Field(0.2, ge=0, le=1)
    confidence: float = Field(0.5, ge=0, le=1)
    curiosity: float = Field(0.5, ge=0, le=1)
    empathy: float = Field(0.5, ge=0, le=1)
    honesty: float = Field(0.7, ge=0, le=1)
    risk_tolerance: float = Field(0.4, ge=0, le=1)
    loyalty: float = Field(0.5, ge=0, le=1)
    sociability: float = Field(0.5, ge=0, le=1)


class Emotion(BaseModel):
    valence: float = Field(0, ge=-1, le=1)
    arousal: float = Field(0, ge=0, le=1)
    fear: float = Field(0, ge=0, le=1)
    anger: float = Field(0, ge=0, le=1)
    joy: float = Field(0, ge=0, le=1)
    stress: float = Field(0, ge=0, le=1)


class MemoryItem(BaseModel):
    id: str
    summary: str = Field(max_length=400)
    event_type: str = "None"
    minutes_ago: float = Field(0, ge=0)
    place: str = ""
    source: str = "Observed"          # Observed | Heard | ToldBy | Conversation | Self
    source_npc: str = ""
    confidence: float = Field(1, ge=0, le=1)
    importance: float = Field(0.5, ge=0, le=1)


class Relationship(BaseModel):
    affinity: float = Field(0, ge=-1, le=1)
    trust: float = Field(0.3, ge=0, le=1)
    familiarity: float = Field(0, ge=0, le=1)
    label: str = "stranger"


class Turn(BaseModel):
    speaker: str  # "player" or "npc"
    text: str = Field(max_length=600)


# ───────────────────────────── dialogue ─────────────────────────────
class DialogueRequest(BaseModel):
    npc_id: str
    name: str
    age: int = 30
    occupation: str = ""
    employer: str = ""
    employed: bool = True
    backstory: str = Field("", max_length=1200)
    personality: Personality = Personality()
    emotion: Emotion = Emotion()
    current_activity: str = ""
    location: str = ""
    game_clock: str = ""
    weather: str = "clear"
    relationship_with_player: Relationship = Relationship()
    player_appearance: str = ""
    memories: list[MemoryItem] = Field(default_factory=list, max_length=12)
    known_places: list[str] = Field(default_factory=list, max_length=40)
    history: list[Turn] = Field(default_factory=list, max_length=12)
    player_line: str = Field(min_length=1, max_length=500)


class Intent(str, Enum):
    answer = "answer"
    small_talk = "small_talk"
    refuse = "refuse"
    ask_back = "ask_back"
    end_conversation = "end_conversation"
    flee = "flee"


class MemoryToStore(BaseModel):
    summary: str = Field(min_length=1, max_length=240)
    importance: float = Field(0.4, ge=0, le=1)
    tags: list[str] = Field(default_factory=list, max_length=8)


class DialogueResult(BaseModel):
    """What the model must return (validated) — the game applies it with its own clamps."""
    reply: str = Field(min_length=1, max_length=400)
    intent: Intent = Intent.answer
    valence_delta: float = Field(0, ge=-0.5, le=0.5)
    arousal_delta: float = Field(0, ge=-0.5, le=0.5)
    affinity_delta: float = Field(0, ge=-0.3, le=0.3)
    trust_delta: float = Field(0, ge=-0.3, le=0.3)
    memory_to_store: Optional[MemoryToStore] = None
    cited_memory_ids: list[str] = Field(default_factory=list, max_length=6)

    @field_validator("reply")
    @classmethod
    def no_stage_directions(cls, v: str) -> str:
        v = v.strip()
        if v.startswith("{") or "```" in v:
            raise ValueError("reply must be spoken text, not code or JSON")
        return v


class DialogueResponse(DialogueResult):
    npc_id: str
    provider: str


# JSON schema handed to Claude's structured outputs (kept simple: types + enums + required)
DIALOGUE_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "intent": {"type": "string", "enum": [i.value for i in Intent]},
        "valence_delta": {"type": "number"},
        "arousal_delta": {"type": "number"},
        "affinity_delta": {"type": "number"},
        "trust_delta": {"type": "number"},
        "memory_to_store": {
            "anyOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "properties": {
                        "summary": {"type": "string"},
                        "importance": {"type": "number"},
                        "tags": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["summary", "importance", "tags"],
                    "additionalProperties": False,
                },
            ]
        },
        "cited_memory_ids": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["reply", "intent", "valence_delta", "arousal_delta", "affinity_delta", "trust_delta", "memory_to_store", "cited_memory_ids"],
    "additionalProperties": False,
}


# ───────────────────────────── decisions ─────────────────────────────
class DecisionRequest(BaseModel):
    npc_id: str
    name: str
    personality: Personality = Personality()
    emotion: Emotion = Emotion()
    current_goal: str
    observed_event: str = ""
    event_distance_m: float = Field(0, ge=0)
    game_clock: str = ""
    memories: list[MemoryItem] = Field(default_factory=list, max_length=8)
    allowed_actions: list[str] = Field(min_length=1, max_length=12)


class DecisionResult(BaseModel):
    decision: str
    priority: float = Field(0.5, ge=0, le=1)
    reason: str = Field("", max_length=200)
    next_action: str = Field("", max_length=80)


class DecisionResponse(DecisionResult):
    npc_id: str
    current_goal: str
    observed_event: str
    accepted: bool
    provider: str


DECISION_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "decision": {"type": "string"},
        "priority": {"type": "number"},
        "reason": {"type": "string"},
        "next_action": {"type": "string"},
    },
    "required": ["decision", "priority", "reason", "next_action"],
    "additionalProperties": False,
}


# ───────────────────────────── memory sync ─────────────────────────────
class MemoryRecord(BaseModel):
    memory_id: str
    npc_id: str
    tier: str = Field(pattern="^(Working|Episodic|Semantic)$")
    event_type: str
    summary: str = Field(max_length=400)
    tags: list[str] = Field(default_factory=list)
    game_time: float
    location: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0], min_length=3, max_length=3)
    place: str = ""
    participants: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    importance: float = Field(ge=0, le=1)
    source: str
    source_npc: str = ""
    valence: float = Field(0, ge=-1, le=1)
    arousal: float = Field(0, ge=0, le=1)
    expires_at: float = -1


class MemorySync(BaseModel):
    memories: list[MemoryRecord] = Field(max_length=5000)


# ───────────────────────────── grounding / validation ─────────────────────────────
def ground_dialogue(result: DialogueResult, req: DialogueRequest) -> DialogueResult:
    """Drop citations of memories the NPC doesn't have, clamp memory importance."""
    known = {m.id for m in req.memories}
    result.cited_memory_ids = [m for m in result.cited_memory_ids if m in known]
    return result


def validate_decision(result: DecisionResult, req: DecisionRequest) -> tuple[DecisionResult, bool]:
    """A decision is only a proposal: it must be one of the actions the game allowed."""
    allowed = {a.strip().lower() for a in req.allowed_actions}
    if result.decision.strip().lower() not in allowed:
        return DecisionResult(decision="keep_current_goal", priority=0.0, reason="proposal rejected: not an allowed action"), False
    result.decision = result.decision.strip().lower()
    return result, True
