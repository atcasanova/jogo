"""Strictly read-only iControl REST adapter for BIG-IP health information.

The adapter deliberately exposes no generic request method.  Every network call
passes through :meth:`_get`; this makes an accidental state-changing request a
hard failure rather than a convention that callers have to remember.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests


class ReadOnlyViolation(RuntimeError):
    """Raised when code attempts an HTTP verb other than GET."""


@dataclass(frozen=True)
class Thresholds:
    cpu: float = 80.0
    memory: float = 85.0
    disk: float = 80.0


class F5HealthAdapter:
    """Collect a normalized health snapshot using GET requests only."""

    SYSTEM_STATS = "/mgmt/tm/sys/performance/system/stats"
    TMM_STATS = "/mgmt/tm/sys/performance/all-stats"
    DISK_STATS = "/mgmt/tm/sys/disk"
    FAILOVER = "/mgmt/tm/cm/failover-status"
    SYNC = "/mgmt/tm/cm/sync-status"
    DEVICES = "/mgmt/tm/cm/device"
    VIRTUALS = "/mgmt/tm/ltm/virtual/stats"
    NODES = "/mgmt/tm/ltm/node/stats"

    def __init__(
        self,
        host: str,
        username: str,
        password: str,
        *,
        verify_tls: bool = True,
        timeout: tuple[int, int] = (5, 30),
        session: requests.Session | None = None,
    ) -> None:
        self.base_url = f"https://{host.strip().rstrip('/')}"
        self.verify_tls = verify_tls
        self.timeout = timeout
        self.session = session or requests.Session()
        self.session.auth = (username, password)
        self.session.headers.update({"Accept": "application/json"})

    def _request(self, method: str, path: str) -> dict[str, Any]:
        if method.upper() != "GET":
            raise ReadOnlyViolation(f"Método {method} bloqueado: adaptador somente leitura")
        response = self.session.get(
            f"{self.base_url}{path}",
            timeout=self.timeout,
            verify=self.verify_tls,
        )
        response.raise_for_status()
        return response.json()

    def _get(self, path: str) -> dict[str, Any]:
        return self._request("GET", path)

    @staticmethod
    def _flatten(value: Any) -> list[tuple[str, Any]]:
        result: list[tuple[str, Any]] = []
        if isinstance(value, dict):
            for key, child in value.items():
                result.append((str(key).lower(), child))
                result.extend(F5HealthAdapter._flatten(child))
        elif isinstance(value, list):
            for child in value:
                result.extend(F5HealthAdapter._flatten(child))
        return result

    @classmethod
    def _percent(cls, payload: dict[str, Any], *hints: str) -> float | None:
        """Best-effort extraction across TMOS versions' nested stats formats."""
        hints = tuple(h.lower() for h in hints)
        for key, value in cls._flatten(payload):
            if not all(hint in key for hint in hints):
                continue
            candidate = value.get("value") if isinstance(value, dict) else value
            try:
                number = float(str(candidate).rstrip("%"))
            except (TypeError, ValueError):
                continue
            if 0 <= number <= 100:
                return round(number, 2)
        return None

    @classmethod
    def _text(cls, payload: dict[str, Any], *hints: str) -> str:
        hints = tuple(h.lower() for h in hints)
        for key, value in cls._flatten(payload):
            if all(hint in key for hint in hints):
                if isinstance(value, dict):
                    value = value.get("description") or value.get("value")
                if value is not None and not isinstance(value, (dict, list)):
                    return str(value)
        return "Indisponível"

    def collect(self) -> dict[str, Any]:
        """Return one appliance snapshot; credentials are never included."""
        system = self._get(self.SYSTEM_STATS)
        tmm = self._get(self.TMM_STATS)
        disk = self._get(self.DISK_STATS)
        failover = self._get(self.FAILOVER)
        sync = self._get(self.SYNC)
        devices = self._get(self.DEVICES)
        virtuals = self._get(self.VIRTUALS)
        nodes = self._get(self.NODES)

        return {
            "hostname": self._text(devices, "hostname"),
            "role": self._text(failover, "status"),
            "sync": self._text(sync, "status"),
            "cpu_tmm": self._percent(tmm, "cpu"),
            "memory_tmm": self._percent(tmm, "memory"),
            "memory_host": self._percent(system, "memory"),
            "disk_var": self._percent(disk, "var"),
            "offline_virtuals": self._offline_count(virtuals),
            "offline_nodes": self._offline_count(nodes),
            # Logs cannot be fetched through iControl REST with GET.  The bash
            # endpoint requires POST, so it is intentionally not used here.
            "log_alerts": [],
            "log_note": "Coleta de logs omitida: util/bash exigiria POST.",
        }

    @classmethod
    def _offline_count(cls, payload: dict[str, Any]) -> int:
        count = 0
        for key, value in cls._flatten(payload):
            if "availabilitystate" not in key:
                continue
            if isinstance(value, dict):
                value = value.get("description") or value.get("value")
            if value is not None and str(value).lower() not in {"available", "unknown"}:
                count += 1
        return count


def build_action_plan(devices: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Classify cross-device findings from highest to lowest impact."""
    actions: list[dict[str, str]] = []
    for device in devices:
        name = device.get("hostname") or device.get("address", "BIG-IP")
        role = str(device.get("role", "")).lower()
        sync = str(device.get("sync", "")).lower()
        if "split" in role or "offline" in role:
            actions.append(_action(0, name, "Estado DSC crítico", "Validar failover e conectividade do trust domain antes de qualquer sincronização."))
        if "out" in sync or "disconnected" in sync:
            actions.append(_action(0, name, "ConfigSync fora de sincronismo", "Na GUI, compare as alterações e sincronize a partir do nó autoritativo."))
        if _above(device.get("cpu_tmm"), 80):
            actions.append(_action(0, name, "CPU TMM exausta", "Identificar o Virtual Server ofensor com 'tmsh show sys tmm-info' e analisar o tráfego."))
        if _above(device.get("memory_tmm"), 85) or _above(device.get("memory_host"), 85):
            actions.append(_action(0, name, "Memória elevada", "Correlacionar consumo por processo e abrir caso F5 antes de reiniciar serviços."))
        if device.get("offline_nodes") or device.get("offline_virtuals"):
            actions.append(_action(0, name, "Objetos LTM offline", "Validar monitores, rota e serviço de backend; evite habilitar objetos sem diagnóstico."))
        if _above(device.get("disk_var"), 80):
            actions.append(_action(1, name, "Uso elevado de /var", "Revisar retenção de logs, UCS e core files conforme o procedimento de mudança."))
    return sorted(actions, key=lambda item: int(item.pop("_order")))


def _above(value: Any, threshold: float) -> bool:
    try:
        return float(value) >= threshold
    except (TypeError, ValueError):
        return False


def _action(order: int, device: str, title: str, instruction: str) -> dict[str, str]:
    return {"_order": str(order), "priority": "Crítica" if order == 0 else "Média", "device": device, "title": title, "instruction": instruction}
