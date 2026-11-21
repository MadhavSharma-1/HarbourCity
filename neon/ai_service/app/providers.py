"""Model back-ends. Each returns a parsed JSON dict or raises ProviderUnavailable.

- AnthropicProvider: Claude via the official Anthropic SDK, structured JSON output.
- OllamaProvider:    any local model served by Ollama (good on Apple Silicon Macs).
- RulesProvider:     no model; the game uses its own grounded rule-based dialogue.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import httpx

PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
DIALOGUE_SYSTEM = (PROMPTS / "dialogue_system.txt").read_text()
DECISION_SYSTEM = (PROMPTS / "decision_system.txt").read_text()


class ProviderUnavailable(Exception):
    """The game should fall back to its local rules."""


class Provider:
    name = "base"

    def complete_json(self, system: str, user: str, schema: dict, max_tokens: int = 2000) -> dict:
        raise NotImplementedError


class RulesProvider(Provider):
    name = "rules"

    def complete_json(self, system, user, schema, max_tokens=2000):
        raise ProviderUnavailable("rules provider: game handles this locally")


class AnthropicProvider(Provider):
    name = "anthropic"

    def __init__(self):
        import anthropic  # imported lazily so the service runs without it in rules/ollama mode

        self._anthropic = anthropic
        self.client = anthropic.Anthropic(timeout=30.0, max_retries=1)  # key from ANTHROPIC_API_KEY or `ant auth login`
        self.model = os.getenv("NEON_ANTHROPIC_MODEL", "claude-opus-5-5")
        self.effort = os.getenv("NEON_EFFORT", "low")  # street conversations: keep latency low

    def complete_json(self, system, user, schema, max_tokens=2000):
        a = self._anthropic
        try:
            resp = self.client.beta.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                # stable system prompt first so it can be cached across requests
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": user}],
                output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
                # if a safety classifier declines, let the API re-run the request on a fallback model
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except a.RateLimitError as e:
            raise ProviderUnavailable(f"rate limited: {e}") from e
        except a.APIStatusError as e:
            raise ProviderUnavailable(f"API error {e.status_code}") from e
        except a.APIConnectionError as e:
            raise ProviderUnavailable(f"connection error: {e}") from e
        if resp.stop_reason == "refusal":
            raise ProviderUnavailable("model declined")
        if resp.stop_reason == "max_tokens":
            raise ProviderUnavailable("response truncated")
        text = next((b.text for b in resp.content if b.type == "text"), "")
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            raise ProviderUnavailable("invalid JSON from model") from e


class OllamaProvider(Provider):
    name = "ollama"

    def __init__(self):
        self.url = os.getenv("NEON_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
        self.model = os.getenv("NEON_OLLAMA_MODEL", "llama3.1:8b")

    def complete_json(self, system, user, schema, max_tokens=2000):
        try:
            r = httpx.post(f"{self.url}/api/chat", timeout=60, json={
                "model": self.model, "stream": False, "format": schema,
                "options": {"num_predict": max_tokens},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            })
            r.raise_for_status()
            return json.loads(r.json()["message"]["content"])
        except (httpx.HTTPError, KeyError, json.JSONDecodeError) as e:
            raise ProviderUnavailable(f"ollama: {e}") from e


def make_provider(name: str | None = None) -> Provider:
    name = (name or os.getenv("NEON_PROVIDER", "rules")).lower()
    if name == "anthropic":
        return AnthropicProvider()
    if name == "ollama":
        return OllamaProvider()
    return RulesProvider()
