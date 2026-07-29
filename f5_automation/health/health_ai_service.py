"""LLM diagnostics for the health report, reusing the Govi configuration.

The service only sends normalized health facts to the model.  F5 credentials,
request objects and raw log contents never cross this boundary.  If the shared
LLM is unavailable, callers receive the deterministic action plan instead.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import requests
from django.conf import settings

from .health_adapter import build_action_plan


class HealthAIError(RuntimeError):
    """A safe, reportable failure from the diagnostic service."""


@dataclass(frozen=True)
class GoviLLMConfig:
    endpoint: str
    api_key: str
    model: str
    api_version: str = "2024-10-21"
    timeout: int = 45

    @classmethod
    def from_settings(cls) -> "GoviLLMConfig":
        """Read the same setting namespace used by the existing /govi module."""
        shared = getattr(settings, "GOVI_LLM_CONFIG", {})

        def value(dict_key: str, *setting_names: str, default: Any = "") -> Any:
            if shared.get(dict_key) not in (None, ""):
                return shared[dict_key]
            for name in setting_names:
                candidate = getattr(settings, name, None)
                if candidate not in (None, ""):
                    return candidate
            return default

        config = cls(
            endpoint=str(value("endpoint", "GOVI_LLM_ENDPOINT", "AZURE_OPENAI_ENDPOINT", "OPENAI_BASE_URL")),
            api_key=str(value("api_key", "GOVI_LLM_API_KEY", "AZURE_OPENAI_API_KEY", "OPENAI_API_KEY")),
            model=str(value("model", "GOVI_LLM_MODEL", "AZURE_OPENAI_DEPLOYMENT", "OPENAI_MODEL")),
            api_version=str(value("api_version", "GOVI_LLM_API_VERSION", "AZURE_OPENAI_API_VERSION", default="2024-10-21")),
            timeout=int(value("timeout", "GOVI_LLM_TIMEOUT", default=45)),
        )
        if not config.endpoint or not config.api_key or not config.model:
            raise HealthAIError("Configuração compartilhada da IA do Govi está incompleta.")
        return config


SYSTEM_PROMPT = """Você é um engenheiro sênior F5 BIG-IP. Analise somente os fatos
fornecidos, sem inventar métricas. Responda em português e em JSON válido com:
executive_summary (string), device_diagnostics (objeto hostname -> string) e
action_plan (lista de objetos priority, device, title, instruction). Ordene ações:
split-brain/DSC, CPU ou memória exausta, disco crítico e objetos offline antes de
avisos preventivos. Recomendações são instruções para operador, nunca comandos a
serem executados automaticamente. Não repita segredos ou dados não fornecidos."""


class HealthAIService:
    """OpenAI-compatible client configured from the existing Govi settings."""

    ALLOWED_FIELDS = (
        "hostname", "address", "role", "sync", "cpu_tmm", "memory_tmm",
        "memory_host", "disk_var", "offline_virtuals", "offline_nodes",
    )

    def __init__(
        self,
        config: GoviLLMConfig | None = None,
        *,
        session: requests.Session | None = None,
    ) -> None:
        self.config = config or GoviLLMConfig.from_settings()
        self.session = session or requests.Session()

    def analyze(self, devices: list[dict[str, Any]]) -> dict[str, Any]:
        facts = [{key: device.get(key) for key in self.ALLOWED_FIELDS} for device in devices]
        response = self.session.post(
            self._completion_url(),
            headers=self._headers(),
            json={
                "model": self.config.model,
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": json.dumps({"devices": facts}, ensure_ascii=False)},
                ],
            },
            timeout=self.config.timeout,
        )
        response.raise_for_status()
        try:
            content = response.json()["choices"][0]["message"]["content"]
            parsed = json.loads(self._strip_fence(content))
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise HealthAIError("A IA do Govi retornou uma resposta inválida.") from exc
        return self._validate(parsed)

    def _completion_url(self) -> str:
        endpoint = self.config.endpoint.rstrip("/")
        if "/chat/completions" in endpoint:
            return endpoint
        if "openai.azure.com" in endpoint:
            return f"{endpoint}/openai/deployments/{self.config.model}/chat/completions?api-version={self.config.api_version}"
        return f"{endpoint}/chat/completions"

    def _headers(self) -> dict[str, str]:
        key_header = "api-key" if "openai.azure.com" in self.config.endpoint else "Authorization"
        key_value = self.config.api_key if key_header == "api-key" else f"Bearer {self.config.api_key}"
        return {"Content-Type": "application/json", key_header: key_value}

    @staticmethod
    def _strip_fence(content: str) -> str:
        return re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.IGNORECASE)

    @staticmethod
    def _validate(data: Any) -> dict[str, Any]:
        if not isinstance(data, dict) or not isinstance(data.get("executive_summary"), str):
            raise HealthAIError("A IA do Govi não forneceu resumo executivo válido.")
        diagnostics = data.get("device_diagnostics", {})
        actions = data.get("action_plan", [])
        if not isinstance(diagnostics, dict) or not isinstance(actions, list):
            raise HealthAIError("A IA do Govi não forneceu diagnóstico estruturado válido.")
        clean_actions = []
        for action in actions:
            if not isinstance(action, dict):
                continue
            clean_actions.append({key: str(action.get(key, "")) for key in ("priority", "device", "title", "instruction")})
        return {
            "executive_summary": data["executive_summary"],
            "device_diagnostics": {str(key): str(value) for key, value in diagnostics.items()},
            "action_plan": clean_actions,
        }


def analyze_with_fallback(devices: list[dict[str, Any]]) -> dict[str, Any]:
    """Use Govi's LLM when configured, preserving PDF generation on failure."""
    try:
        result = HealthAIService().analyze(devices)
        result["source"] = "IA (configuração compartilhada do Govi)"
        return result
    except (HealthAIError, requests.RequestException) as exc:
        return {
            "executive_summary": "Análise por IA indisponível; foi aplicada a classificação local de segurança.",
            "device_diagnostics": {},
            "action_plan": build_action_plan(devices),
            "source": "Classificação local",
            "warning": str(exc),
        }
