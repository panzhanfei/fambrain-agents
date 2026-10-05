from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class KmSnapshot:
    hits: list[dict]
    coverage: str
    notes: str | None
    query_profile: str
    candidate_count: int
    confidence_tier: str
    latency_ms: int = 0


@dataclass
class PipelineSnapshot:
    steps: list[str] = field(default_factory=list)
    answer: str = ""
    error: str | None = None
    hit_count: int = 0
    coverage: str = "none"
    latency_ms: int = 0


def _re(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.IGNORECASE)


def assert_km(snap: KmSnapshot, expect: dict) -> list[str]:
    issues: list[str] = []
    if expect.get("expectProfile") and snap.query_profile != expect["expectProfile"]:
        issues.append(f"profile 期望 {expect['expectProfile']} 实际 {snap.query_profile}")
    if expect.get("minHits") is not None and len(snap.hits) < expect["minHits"]:
        issues.append(f"hits 期望 >={expect['minHits']} 实际 {len(snap.hits)}")
    if expect.get("maxHits") is not None and len(snap.hits) > expect["maxHits"]:
        issues.append(f"hits 期望 <={expect['maxHits']} 实际 {len(snap.hits)}")
    if expect.get("coverage") and snap.coverage != expect["coverage"]:
        issues.append(f"coverage 期望 {expect['coverage']} 实际 {snap.coverage}")
    top = snap.hits[0] if snap.hits else None
    if expect.get("topPathRe") and top and not _re(expect["topPathRe"]).search(top["path"]):
        issues.append(f"Top1 path 未匹配 /{expect['topPathRe']}/")
    if expect.get("notTopPathRe") and top and _re(expect["notTopPathRe"]).search(top["path"]):
        issues.append(f"Top1 不应匹配 /{expect['notTopPathRe']}/")
    if expect.get("excerptRe") and top and not _re(expect["excerptRe"]).search(top["excerpt"]):
        issues.append(f"Top1 excerpt 未匹配 /{expect['excerptRe']}/")
    if expect.get("excerptAnyRe"):
        if not any(_re(expect["excerptAnyRe"]).search(hit["excerpt"]) for hit in snap.hits):
            issues.append(f"任一 excerpt 未匹配 /{expect['excerptAnyRe']}/")
    if expect.get("minExperienceHits") is not None:
        experience_hits = [
            hit
            for hit in snap.hits
            if re.search(r"/experience/", hit["path"], re.IGNORECASE)
            and not re.search(r"readme", hit["path"], re.IGNORECASE)
        ]
        if len(experience_hits) < expect["minExperienceHits"]:
            issues.append(
                f"experience hits 期望 >={expect['minExperienceHits']} 实际 {len(experience_hits)}"
            )
    project_hit = any(re.search(r"/projects/", hit["path"], re.IGNORECASE) for hit in snap.hits)
    if expect.get("noProjectsInHits") and project_hit:
        issues.append("hits 不应含 projects/")
    if expect.get("notesRe") and (not snap.notes or not _re(expect["notesRe"]).search(snap.notes)):
        issues.append(f"notes 未匹配 /{expect['notesRe']}/")
    if expect.get("expectConfidenceTier") and snap.confidence_tier != expect["expectConfidenceTier"]:
        issues.append(
            f"confidenceTier 期望 {expect['expectConfidenceTier']} 实际 {snap.confidence_tier}"
        )
    if snap.candidate_count > 0 and not snap.hits:
        issues.append("candidates>0 但 hits=0")
    return issues


def assert_pipeline(snap: PipelineSnapshot, expect: dict) -> list[str]:
    issues: list[str] = []
    if snap.error:
        issues.append(f"pipeline error: {snap.error}")
    for step in expect.get("mustIncludeSteps") or []:
        if step not in snap.steps:
            issues.append(f"缺少 step: {step}")
    for group in expect.get("mustIncludeAnySteps") or []:
        if group and not any(step in snap.steps for step in group):
            issues.append(f"缺少 step（任一即可）: {' | '.join(group)}")
    for step in expect.get("mustNotIncludeSteps") or []:
        if step in snap.steps:
            issues.append(f"不应有 step: {step}")
    if expect.get("minAnswerLength") is not None and len(snap.answer.strip()) < expect["minAnswerLength"]:
        issues.append(
            f"answer 长度期望 >={expect['minAnswerLength']} 实际 {len(snap.answer.strip())}"
        )
    if expect.get("answerRe") and not _re(expect["answerRe"]).search(snap.answer):
        issues.append(f"answer 未匹配 /{expect['answerRe']}/")
    if (
        expect.get("answerMustNotRe")
        and _re(expect["answerMustNotRe"]).search(snap.answer)
        and not (expect.get("answerRe") and _re(expect["answerRe"]).search(snap.answer))
    ):
        issues.append(f"answer 不应匹配 /{expect['answerMustNotRe']}/")
    for needle in expect.get("answerMustIncludeAll") or []:
        if needle not in snap.answer:
            issues.append(f"answer 缺少「{needle}」")
    return issues
