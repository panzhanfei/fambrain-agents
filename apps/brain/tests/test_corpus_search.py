from fambrain_agentflow.corpus.search import search_corpus


def test_identity_search_finds_resume():
    hits = search_corpus(
        "cmp9ihokn00000mbmhwh6gn0b",
        "个人简介 简历 姓名",
        query_type="identity",
        topics=["personal", "resume"],
    )
    assert hits
    assert "personal" in hits[0].path
    assert "潘展飞" in hits[0].excerpt
