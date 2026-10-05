from fambrain_corpus.doc_kind import infer_doc_kind, is_relations_roster
from fambrain_corpus.paths import is_noise_path
from fambrain_corpus.sparse import text_to_sparse_vector, tokenize_for_recall


def test_tokenize_expands_cjk_bigrams():
    tokens = tokenize_for_recall("姓名潘展飞")
    assert "姓名" in tokens
    assert "潘展" in tokens


def test_sparse_vector_dedupes_tokens_like_the_node_tokenizer():
    vector = text_to_sparse_vector("react react")
    assert len(vector.indices) == 1
    assert vector.values == [1.0]


def test_noise_and_doc_kind():
    assert is_noise_path("users/u/corpus/personal/README.md")
    assert infer_doc_kind("users/u/corpus/projects/aky.md", "") == "project"
    roster = "| 称呼 | 姓名 |\n|---|---|\n| 哥哥 | 潘小强 |\n| 嫂子 | 乔乔 |"
    assert is_relations_roster(roster)
    assert infer_doc_kind("users/u/corpus/personal/亲友关系.md", roster) == "relations"
