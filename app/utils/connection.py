import asyncio
from datetime import datetime, timezone
from collections import defaultdict
from fastapi import WebSocket
from app.config import get_settings

settings = get_settings()

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[int, list[WebSocket]] = defaultdict(list)

    async def connect(self, websocket: WebSocket, cycle_id: int):
        await websocket.accept()
        self.active_connections[cycle_id].append(websocket)

    def disconnect(self, websocket: WebSocket, cycle_id: int):
        self.active_connections[cycle_id].remove(websocket)

    async def broadcast(self, message: str, cycle_id: int):
        for connection in self.active_connections[cycle_id]:
            await connection.send_text(message)


manager = ConnectionManager()


class RateLimiter:
    def __init__(self, requests_per_minute: int = 60):
        self.requests_per_minute = requests_per_minute
        self.requests: dict[str, list[float]] = {}
        self._lock = asyncio.Lock()

    async def is_allowed(self, client_id: str) -> bool:
        async with self._lock:
            now = datetime.now(timezone.utc).timestamp()
            minute_ago = now - 60
            if client_id not in self.requests:
                self.requests[client_id] = []
            self.requests[client_id] = [t for t in self.requests[client_id] if t > minute_ago]
            if len(self.requests[client_id]) >= self.requests_per_minute:
                return False
            self.requests[client_id].append(now)
            return True


rate_limiter = RateLimiter(requests_per_minute=settings.rate_limit_per_minute)
