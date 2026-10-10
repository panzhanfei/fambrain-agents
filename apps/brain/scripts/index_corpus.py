"""Index every user corpus directory into Qdrant."""

from __future__ import annotations

from fambrain_corpus.index import index_user_corpus
from fambrain_corpus.paths import doc_root
from fambrain_memory import reindex_fact_memories


def main() -> None:
    users = doc_root() / "users"
    if not users.is_dir():
        print("no data/doc/users")
    else:
        for child in sorted(users.iterdir()):
            if not (child / "corpus").is_dir():
                continue
            result = index_user_corpus(child.name)
            print(result)
    print(reindex_fact_memories())


if __name__ == "__main__":
    main()
