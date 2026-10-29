import pytest

from factory_intake.memory import MemoryFactory
from factory_intake.port import MAX_BODY, FactoryError, FactoryPort, ReleaseResult, SourceRef, WorkItemDraft, clamp_draft


def draft(key="k1", title="t"):
    return WorkItemDraft(source=SourceRef(kind="cli", external_id="1"), title=title, idempotency_key=key)


def test_memory_factory_satisfies_the_port():
    assert isinstance(MemoryFactory(), FactoryPort)


def test_submit_is_idempotent_by_key():
    f = MemoryFactory()
    assert f.submit(draft()).id == f.submit(draft(title="other")).id
    assert f.submit(draft("k2")).id != f.submit(draft()).id


def test_claim_then_release_goes_to_review_not_done():
    f = MemoryFactory()
    item = f.submit(draft())
    claimed = f.claim(item.id, "claude-code")
    assert claimed.state == "claimed" and claimed.claim.holder == "claude-code"
    with pytest.raises(FactoryError) as exc:
        f.claim(item.id, "codex")
    assert exc.value.code == "not_claimable"
    released = f.release(item.id, ReleaseResult(summary="s", branch="b", status="needs_review"))
    assert released.state == "waiting_human" and released.claim is None
    with pytest.raises(FactoryError):
        f.release(item.id, ReleaseResult(summary="s", status="abandoned"))


def test_abandoning_a_claim_requeues_and_a_release_can_never_complete():
    f = MemoryFactory()
    item = f.submit(draft())
    f.claim(item.id, "a")
    assert f.release(item.id, ReleaseResult(summary="gave up", status="abandoned")).state == "queued"
    with pytest.raises(Exception):
        ReleaseResult(summary="x", status="done")


def test_cancelling_a_claimed_item_drops_the_claim():
    f = MemoryFactory()
    item = f.submit(draft())
    f.claim(item.id, "a")
    assert f.cancel(item.id).claim is None


def test_idempotency_keys_are_scoped_to_their_source():
    f = MemoryFactory()
    a = f.submit(draft("k"))
    other = f.submit(WorkItemDraft(source=SourceRef(kind="webhook", external_id="9"), title="mine", idempotency_key="k"))
    assert other.id != a.id and other.title == "mine"


def test_clamp_draft_cuts_oversized_text_and_names_a_blank_title():
    d = clamp_draft(SourceRef(kind="github", external_id="1"), "  ", "b" * 70_000, ["x" * 500] * 80, "u" * 500, "k" * 500)
    assert d.title == "(untitled)" and len(d.body) == MAX_BODY and len(d.labels) == 50 and len(d.labels[0]) == 100
    assert len(d.requested_by) == 200 and len(d.idempotency_key) == 200


def test_cancel_and_unknown_ids():
    f = MemoryFactory()
    item = f.submit(draft())
    assert f.cancel(item.id).state == "cancelled"
    with pytest.raises(FactoryError):
        f.cancel(item.id)
    with pytest.raises(FactoryError) as exc:
        f.get("nope")
    assert exc.value.code == "not_found"


def test_drafts_reject_unknown_fields_and_oversize_text():
    with pytest.raises(Exception):
        WorkItemDraft(source=SourceRef(kind="cli", external_id="1"), title="t", idempotency_key="k", extra="x")
    with pytest.raises(Exception):
        WorkItemDraft(source=SourceRef(kind="cli", external_id="1"), title="t" * 301, idempotency_key="k")
