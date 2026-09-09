"""
NETRA-X Redis Streams Event Bus & Pipeline Coordinator
Dispatches PAGE_COLLECTED -> EXTRACTION_COMPLETED -> RELATIONSHIP_DISCOVERED -> GRAPH_PROJECTED events.
"""

import json
from datetime import datetime
from typing import Dict, Any, List, Callable, Optional

try:
    import redis
    HAS_REDIS = True
except ImportError:
    HAS_REDIS = False


# Event Stream Topics
STREAM_PAGE_COLLECTED = "stream:page_collected"
STREAM_EXTRACTION_COMPLETED = "stream:extraction_completed"
STREAM_RELATIONSHIP_DISCOVERED = "stream:relationship_discovered"
STREAM_GRAPH_PROJECTED = "stream:graph_projected"


class RedisEventBus:
    """Redis Streams event bus for real-time asynchronous pipeline coordination."""

    def __init__(self, redis_url: str = "redis://localhost:6379/0"):
        self.redis_url = redis_url
        self.client = None
        self.in_memory_queue: List[Dict[str, Any]] = []

        if HAS_REDIS:
            try:
                self.client = redis.from_url(redis_url, decode_responses=True)
            except Exception:
                self.client = None

    def publish_event(self, stream_name: str, event_data: Dict[str, Any]) -> str:
        """Publish event to Redis Stream or fallback in-memory queue."""
        payload = {
            "timestamp": datetime.utcnow().isoformat(),
            "payload": json.dumps(event_data)
        }

        if self.client:
            try:
                msg_id = self.client.xadd(stream_name, payload)
                return str(msg_id)
            except Exception:
                pass

        # Fallback to in-memory event tracking
        msg_id = f"mem_{len(self.in_memory_queue) + 1}"
        self.in_memory_queue.append({
            "stream": stream_name,
            "id": msg_id,
            "data": payload,
            "event_data": event_data
        })
        return msg_id

    def consume_stream(self, stream_name: str, count: int = 10) -> List[Dict[str, Any]]:
        """Consume pending events from Redis stream or in-memory queue."""
        if self.client:
            try:
                # Read latest entries from stream
                res = self.client.xread({stream_name: "0"}, count=count)
                out = []
                for _, messages in res:
                    for msg_id, fields in messages:
                        out.append({
                            "id": msg_id,
                            "stream": stream_name,
                            "payload": json.loads(fields.get("payload", "{}"))
                        })
                return out
            except Exception:
                pass

        # Fallback: filter in-memory queue
        filtered = [
            {"id": item["id"], "stream": item["stream"], "payload": item["event_data"]}
            for item in self.in_memory_queue if item["stream"] == stream_name
        ]
        return filtered[:count]

    def get_queued_events(self) -> List[Dict[str, Any]]:
        """Return all queued events for pipeline inspection."""
        return self.in_memory_queue


# Singleton Instance
event_bus = RedisEventBus()
