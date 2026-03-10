"""WebSocket progress manager for experiment execution."""

import asyncio


class ProgressManager:
    """Manages WebSocket subscribers for experiment progress."""

    def __init__(self):
        self._subscribers: dict[int, list[asyncio.Queue]] = {}

    def subscribe(self, experiment_id: int, queue: asyncio.Queue):
        self._subscribers.setdefault(experiment_id, []).append(queue)

    def unsubscribe(self, experiment_id: int, queue: asyncio.Queue):
        subs = self._subscribers.get(experiment_id, [])
        if queue in subs:
            subs.remove(queue)
        if not subs:
            self._subscribers.pop(experiment_id, None)

    def broadcast(self, experiment_id: int, message: dict):
        for queue in self._subscribers.get(experiment_id, []):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                pass


_manager: ProgressManager | None = None


def get_manager() -> ProgressManager:
    global _manager
    if _manager is None:
        _manager = ProgressManager()
    return _manager
