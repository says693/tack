"""Persist UTC epoch seconds; display and calendar scheduling use local time."""
from datetime import datetime, timezone
import time


def now() -> int:
    return int(time.time())


def iso(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat(timespec="seconds")


def legacy_timestamp(value: str) -> int:
    # Legacy date-only and naive timestamps were local calendar values.
    # Invalid persisted values stop migration, rather than becoming "due now".
    return int(datetime.fromisoformat(value).astimezone().timestamp())
