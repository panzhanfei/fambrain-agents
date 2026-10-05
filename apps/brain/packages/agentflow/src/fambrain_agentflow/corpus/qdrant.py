"""Compatibility exports. Qdrant naming lives in fambrain_corpus."""

from fambrain_corpus import EMBEDDING_MODEL, corpus_collection_name, memory_collection_name

MEM0_COLLECTION = memory_collection_name()
DENSE_VECTOR_NAME = "dense"
SPARSE_VECTOR_NAME = "sparse"
RERANKER_MODEL = "BAAI/bge-reranker-v2-m3"

__all__ = [
    "DENSE_VECTOR_NAME",
    "EMBEDDING_MODEL",
    "MEM0_COLLECTION",
    "RERANKER_MODEL",
    "SPARSE_VECTOR_NAME",
    "corpus_collection_name",
    "memory_collection_name",
]
