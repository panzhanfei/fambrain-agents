"""Compatibility exports. Vector memories live in fambrain_memory."""

from fambrain_corpus import memory_collection_name
from fambrain_memory import add_user_memory, search_user_memories

__all__ = ["add_user_memory", "memory_collection_name", "search_user_memories"]
