"""Read-only F5 BIG-IP health collection."""

from .health_adapter import F5HealthAdapter, ReadOnlyViolation

__all__ = ["F5HealthAdapter", "ReadOnlyViolation"]
