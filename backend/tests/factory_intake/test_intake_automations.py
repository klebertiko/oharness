import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from ruamel.yaml import YAML

from factory_intake.automations import (AutomationEngine, AutomationError, github_event, load_automations, parse_automation, webhook_event)
from factory_intake.cron import CronError, parse_cron
from factory_intake.matching import PatternError, check_pattern, match_field, match_payload
from factory_intake.memory import MemoryFactory

UTC = timezone.utc
SCHEMAS = Path(__file__).resolve().parents[2] / "oharness" / "schema"

DEAD_CODE = """---
title: Remove dead code
agent: implement
triggers:
  - provider: schedule
    event: cron_fired
    schedule: {name: weekly-cleanup, cron: "0 3 * * 0", timezone: UTC}
limits: {tokensPerRun: 50000, tokensPerDay: 100000}
---
Find unused code and open a change for review. Never merge.
"""
REVIEW = """---
agent: reviewer
triggers:
  - provider: github
    event: pull_request
    filter:
      repos: [Acme/Payments]
      base_branches: [main]
      labels: {not_in: [wip]}
      actions: [opened, ready_for_review]
---
Review the pull request.
"""
HOOK = """---
agent: foreman
triggers:
  - provider: webhook
    event: received
    filter:
      webhooks: [ci]
      payload:
        event: [deploy.finished]
        env: {not_in: [dev, staging]}
        service: {exists: true}
---
A deploy finished; check the service.
"""


def dt(*a):
    return datetime(*a, tzinfo=UTC)


# -- cron ---------------------------------------------------------------------------------------------------------------------------
def test_cron_fields_ranges_steps_lists_and_sunday():
    c = parse_cron("*/15 9-17 * * 1-5", "UTC")
    assert c.matches(dt(2026, 10, 28, 9, 30)) and not c.matches(dt(2026, 10, 28, 9, 31)) and not c.matches(dt(2026, 10, 25, 9, 30))  # Sunday
    assert parse_cron("0 0 * * 7", "UTC").matches(dt(2026, 10, 25, 0, 0)) and parse_cron("0 0 * * 0", "UTC").matches(dt(2026, 10, 25, 0, 0))
    assert parse_cron("5,10 * * * *", "UTC").matches(dt(2026, 1, 1, 3, 10))


def test_dom_or_dow_when_both_are_restricted():
    c = parse_cron("0 0 13 * 5", "UTC")  # the 13th OR any Friday
    assert c.matches(dt(2026, 10, 13)) and c.matches(dt(2026, 10, 16)) and not c.matches(dt(2026, 10, 14))


def test_cron_uses_its_time_zone():
    c = parse_cron("0 9 * * *", "America/Sao_Paulo")
    assert c.matches(dt(2026, 10, 28, 12, 0)) and not c.matches(dt(2026, 10, 28, 9, 0))


@pytest.mark.parametrize("bad", ["", "* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "*/0 * * * *", "a * * * *", "5-1 * * * *", "* * * * 8"])
def test_bad_cron_is_rejected(bad):
    with pytest.raises(CronError):
        parse_cron(bad, "UTC")
    with pytest.raises(CronError):
        parse_cron("* * * * *", "Not/AZone")


def test_latest_slot_is_the_most_recent_one_and_none_when_nothing_is_due():
    c = parse_cron("0 3 * * *", "UTC")
    assert c.latest(dt(2026, 10, 25, 12), dt(2026, 10, 28, 4)) == dt(2026, 10, 28, 3)
    assert c.latest(dt(2026, 10, 28, 3, 0), dt(2026, 10, 28, 4)) is None  # the floor itself is not "after"
    assert c.latest(dt(2026, 10, 28, 3, 30), dt(2026, 10, 28, 4)) is None


# -- matching -----------------------------------------------------------------------------------------------------------------------
def test_payload_patterns():
    p = {"event": "deploy.finished", "env": "prod", "n": 1, "ok": True, "tags": ["a", "b"], "pr": {"draft": False, "user": {"type": "User"}}, "items": [{"k": 1}, {"k": 2}]}
    assert match_payload({"event": ["deploy.finished", "x"]}, p)
    assert not match_payload({"event": ["other"]}, p)
    assert match_payload({"env": {"not_in": ["dev", "staging"]}}, p) and not match_payload({"env": {"not_in": ["prod"]}}, p)
    assert match_payload({"missing": {"not_in": ["x"]}}, p) and not match_payload({"missing": ["x"]}, p) and not match_payload({"missing": {"in": ["x"]}}, p)
    assert match_payload({"env": {"exists": True}}, p) and match_payload({"missing": {"exists": False}}, p)
    assert match_payload({"n": [1.0]}, p) and not match_payload({"n": [True]}, p) and not match_payload({"ok": [1]}, p)
    assert match_payload({"tags": ["b"]}, p) and match_payload({"pr": {"draft": [False], "user": {"type": {"not_in": ["Bot"]}}}}, p)
    assert match_payload({"items": {"k": [2]}}, p) and not match_payload({"items": {"k": [3]}}, p)
    assert not match_payload({"nested": {"a": 1}}, p)  # a nested pattern requires its key
    assert not match_payload({"Event": ["deploy.finished"]}, p) and not match_payload({"env": ["PROD"]}, p)  # exact, case-sensitive


def test_pattern_limits_and_shape():
    deep = cur = {}
    for _ in range(12):
        cur["a"] = {}
        cur = cur["a"]
    for bad in (deep, {"a": {"in": "x"}}, {"a": {"exists": 1}}, [1]):
        with pytest.raises(PatternError):
            check_pattern(bad)


def test_field_rules():
    assert match_field(["a", "b"], "b") and not match_field(["a"], "z") and match_field([], "z")
    assert match_field(["bug"], ["bug", "x"]) and match_field({"not_in": ["wip"]}, ["bug"]) and not match_field({"not_in": ["wip"]}, ["wip", "bug"])


# -- parsing ------------------------------------------------------------------------------------------------------------------------
def test_files_validate_against_the_published_schemas_and_parse():
    schema = Draft202012Validator(json.loads((SCHEMAS / "automation.schema.json").read_text()))
    Draft202012Validator.check_schema(schema.schema)
    for text in (DEAD_CODE, REVIEW, HOOK):
        front = text.split("---")[1]
        assert not list(schema.iter_errors(YAML(typ="safe").load(front)))
        assert parse_automation("x", text).triggers
    hook_schema = Draft202012Validator(json.loads((SCHEMAS / "webhook.schema.json").read_text()))
    Draft202012Validator.check_schema(hook_schema.schema)
    assert not list(hook_schema.iter_errors({"authMode": "signature", "signatureScheme": "github", "secretRef": "factory/x"}))
    assert list(hook_schema.iter_errors({"secretRef": "factory/x", "token": "abc"}))


@pytest.mark.parametrize("text", [
    "no frontmatter",
    "---\ntriggers: []\n---\nx",
    "---\ntriggers:\n  - {provider: github, event: nope}\n---\nx",
    "---\ntriggers:\n  - {provider: webhook, event: received}\n---\nx",  # needs webhooks: [names]
    "---\ntriggers:\n  - {provider: github, event: issues, filter: {payload: {a: 1}}}\n---\nx",
    "---\ntriggers:\n  - {provider: schedule, event: cron_fired, schedule: {name: a, cron: '* * *'}}\n---\nx",
    "---\ntriggers:\n  - {provider: schedule, event: cron_fired, schedule: {name: a, cron: '* * * * *'}}\n---\n",  # no prompt
    "---\nsecret: x\ntriggers:\n  - {provider: github, event: issues}\n---\nx",
    "---\ntriggers:\n  - {provider: github, event: issues}\nlimits: {tokensPerDay: 0}\n---\nx",
    "---\ntriggers:\n  - {provider: github, event: issues}\n---\nuse ghp_" + "a" * 36,
])
def test_invalid_automations_are_rejected(text):
    with pytest.raises(AutomationError) as exc:
        parse_automation("x", text)
    assert "ghp_" not in str(exc.value)


def test_load_automations_reads_folders_and_refuses_symlinks(tmp_path):
    folder = tmp_path / "automations" / "cleanup"
    folder.mkdir(parents=True)
    (folder / "automation.md").write_text(DEAD_CODE)
    assert set(load_automations(tmp_path)) == {"cleanup"}
    (tmp_path / "automations" / "evil").symlink_to(folder)
    with pytest.raises(AutomationError):
        load_automations(tmp_path)


# -- engine -------------------------------------------------------------------------------------------------------------------------
@pytest.fixture
def rig(tmp_path):
    port, clock = MemoryFactory(), [1_000_000.0]
    autos = {a.id: a for a in (parse_automation("cleanup", DEAD_CODE), parse_automation("review", REVIEW), parse_automation("deploys", HOOK))}
    engine = AutomationEngine(port, autos, tmp_path / "a.db", clock=lambda: clock[0])
    return engine, port, clock


def test_schedule_fires_once_per_slot_routes_to_the_agent_and_skips_missed_slots(rig):
    engine, port, _ = rig
    assert engine.tick(dt(2026, 10, 23, 12)) == []                       # first tick only records the time
    started = engine.tick(dt(2026, 11, 8, 4))                            # two Sundays missed: only the latest fires
    assert len(started) == 1
    [item] = port.list()
    assert item.source.kind == "schedule" and item.source.ref == "cleanup@2026-11-08T03:00Z"
    assert engine.tick(dt(2026, 11, 8, 5)) == []                         # nothing new is due
    assert engine.history("cleanup")[0]["outcome"] == "fired"


def test_the_item_carries_trusted_instructions_apart_from_untrusted_text(rig):
    engine, port, _ = rig
    engine.tick(dt(2026, 10, 23, 12))
    engine.tick(dt(2026, 10, 25, 4))
    draft = port.drafts[port.list()[0].id]
    assert draft.agent == "implement" and draft.automation == "cleanup" and draft.token_ceiling == 50000
    assert draft.instructions.startswith("Find unused code") and draft.body == ""  # the owner's prompt is instructions; source text would be body


def test_no_stacking_pause_resume_and_the_daily_budget(rig):
    engine, port, clock = rig
    engine.tick(dt(2026, 10, 18, 12))
    assert len(engine.tick(dt(2026, 10, 25, 4))) == 1
    assert engine.tick(dt(2026, 11, 1, 4)) == [] and engine.history("cleanup")[0]["outcome"] == "skipped_open"
    port.cancel(port.list()[0].id)
    engine.set_paused("cleanup", True)
    assert engine.tick(dt(2026, 11, 8, 4)) == [] and engine.history("cleanup")[0]["outcome"] == "skipped_paused"
    engine.set_paused("cleanup", False)
    assert len(engine.tick(dt(2026, 11, 15, 4))) == 1
    first = port.list()[0]
    port._items[first.id] = first.model_copy(update={"cost_tokens": 100_000, "state": "done"})  # spent the whole day budget
    assert engine.tick(dt(2026, 11, 22, 4)) == [] and engine.history("cleanup")[0]["outcome"] == "skipped_budget"
    with pytest.raises(KeyError):
        engine.set_paused("nope", True)


def github_payload(**over):
    base = {"action": "opened", "repository": {"full_name": "acme/payments"}, "sender": {"login": "alice", "type": "User"},
            "pull_request": {"number": 9, "title": "Add retry", "body": "details", "html_url": "u", "labels": [{"name": "feature"}], "base": {"ref": "main"}}}
    base.update(over)
    return base


def test_github_automation_filters_by_repo_branch_label_action_and_skips_bots(rig):
    engine, port, _ = rig
    ev = github_event("pull_request", github_payload(), "d1")
    assert len(engine.handle(ev)) == 1
    [item] = port.list()
    assert item.source.kind == "github" and item.source.thread_ref == "acme/payments#9"
    assert engine.handle(github_event("pull_request", github_payload(), "d1")) == []                                  # a repeat of the delivery
    for payload in (github_payload(repository={"full_name": "other/repo"}), github_payload(action="closed"),
                    github_payload(sender={"login": "ci[bot]", "type": "Bot"}),
                    github_payload(pull_request={**github_payload()["pull_request"], "labels": [{"name": "WIP"}]}),
                    github_payload(pull_request={**github_payload()["pull_request"], "base": {"ref": "dev"}})):
        assert engine.handle(github_event("pull_request", payload, "d2")) == [], payload
    assert github_event("pull_request", {"repository": 5}, "x") is None


def test_webhook_automation_filters_the_payload_and_attaches_it_as_redacted_untrusted_text(rig):
    engine, port, _ = rig
    good = {"event": "deploy.finished", "env": "production", "service": "payments", "note": "token=supersecretvalue1"}
    assert len(engine.handle(webhook_event("ci", good, "k1"))) == 1
    for bad in ({**good, "env": "dev"}, {**good, "event": "other"}, {k: v for k, v in good.items() if k != "service"}):
        assert engine.handle(webhook_event("ci", bad, "k2")) == []
    assert engine.handle(webhook_event("other-hook", good, "k3")) == []
    assert "supersecretvalue1" not in webhook_event("ci", good, "k").body and webhook_event("ci", good, "k").body.startswith("event-payload (untrusted)")


def test_explain_shows_matches_without_creating_anything(rig):
    engine, port, _ = rig
    out = {r["automation"]: r for r in engine.explain(webhook_event("ci", {"event": "deploy.finished", "env": "prod", "service": "x"}, "k"))}
    assert out["deploys"]["matches"] and not out["review"]["matches"] and port.list() == [] and engine.history() == []


def test_a_failing_port_is_recorded_and_does_not_stop_the_others(rig):
    engine, port, _ = rig
    original = port.submit
    port.submit = lambda draft: (_ for _ in ()).throw(RuntimeError("password=hunter2hunter2"))
    assert engine.handle(webhook_event("ci", {"event": "deploy.finished", "env": "p", "service": "x"}, "k")) == []
    row = engine.history("deploys")[0]
    assert row["outcome"] == "error" and "hunter2" not in json.dumps(row)
    port.submit = original


@pytest.mark.parametrize("flt", ["repos: acme/payments", "repos: {inn: [a]}", "repos: [1]", "skip_bots: maybe", "labels: {in: abc}", "webhooks: x"])
def test_filter_shapes_are_validated(flt):
    text = f"---\ntriggers:\n  - provider: github\n    event: issues\n    filter: {{{flt}}}\n---\nx"
    with pytest.raises(AutomationError):
        parse_automation("x", text)
    with pytest.raises(AutomationError):
        parse_automation("x", "---\ntriggers:\n  - {provider: webhook, event: received, filter: {webhooks: deploy-prod}}\n---\nx")


def test_unreadable_files_are_a_refusal_not_a_traceback(tmp_path):
    folder = tmp_path / "automations" / "bad"
    folder.mkdir(parents=True)
    (folder / "automation.md").write_bytes(b"\xff\xfe---")
    with pytest.raises(AutomationError):
        load_automations(tmp_path)
    (folder / "automation.md").write_bytes(b"x" * (256 * 1024 + 1))
    with pytest.raises(AutomationError):
        load_automations(tmp_path)


def test_non_ascii_digits_in_cron_are_a_cron_error():
    for bad in ("² * * * *", "*/٣ * * * *", "٣ * * * *"):
        with pytest.raises(CronError):
            parse_cron(bad, "UTC")


def test_without_a_timezone_the_system_zone_is_used_per_instant(monkeypatch):
    monkeypatch.setenv("TZ", "America/New_York")
    __import__("time").tzset()
    c = parse_cron("0 3 * * *")
    assert c.matches(dt(2026, 1, 15, 8, 0)) and c.matches(dt(2026, 7, 15, 7, 0))  # 03:00 local in winter (UTC-5) and in summer (UTC-4)
    assert not c.matches(dt(2026, 7, 15, 8, 0))


def test_a_failed_slot_is_retried_on_the_next_tick(rig):
    engine, port, _ = rig
    engine.tick(dt(2026, 10, 18, 12))
    original = port.submit
    port.submit = lambda draft: (_ for _ in ()).throw(RuntimeError("down"))
    assert engine.tick(dt(2026, 10, 25, 4)) == [] and engine.history("cleanup")[0]["outcome"] == "error"
    port.submit = original
    assert len(engine.tick(dt(2026, 10, 25, 5))) == 1  # the same 03:00 slot, not lost


def test_closed_items_stop_counting_and_a_busy_history_cannot_forget_open_ones(rig):
    engine, port, _ = rig
    engine.tick(dt(2026, 10, 18, 12))
    engine.tick(dt(2026, 10, 25, 4))
    with engine._db:  # more history rows than the table keeps
        engine._db.executemany("INSERT INTO automation_history (at, automation, trigger, outcome, item, reason) VALUES (0,'cleanup','x','skipped_paused',NULL,'')", [()] * 5100)
    engine._log("cleanup", "x", "skipped_paused")  # one more insert triggers the pruning
    assert engine._open_items("cleanup") == 1
    port.cancel(port.list()[0].id)
    assert engine._open_items("cleanup") == 0


def test_github_automations_respect_the_connector_checks_and_replace_default_routing(tmp_path):
    from intake_client import TestClient
    from factory_intake.config import parse_webhook
    from factory_intake.deliveries import DeliveryLog
    from factory_intake.server import create_app
    from secret_store.memory import MemorySecrets
    import hashlib
    import hmac

    port, secrets = MemoryFactory(), MemorySecrets()
    secrets.put("factory/gh", "s")
    hooks = {"gh": parse_webhook("gh", "authMode: signature\nsignatureScheme: github\nsecretRef: factory/gh\ngithub:\n  repos: [acme/payments]\n  handle: '@payments'\n  allowedAuthors: [alice]\n")}
    engine = AutomationEngine(port, {"review": parse_automation("review", REVIEW)}, tmp_path / "a.db")
    client = TestClient(create_app(port, secrets, hooks, DeliveryLog(tmp_path / "d.db"), automations=engine))

    def post(payload, delivery):
        body = json.dumps(payload).encode()
        sig = "sha256=" + hmac.new(b"s", body, hashlib.sha256).hexdigest()
        return client.post("/hooks/gh", content=body, headers={"x-github-event": "pull_request", "x-github-delivery": delivery, "x-hub-signature-256": sig})

    # outside the allowed authors / repo: the automation does not start either
    assert post(github_payload(sender={"login": "mallory", "type": "User"}), "d1").status_code == 202
    assert post(github_payload(repository={"full_name": "acme/payments2"}), "d2").status_code == 202
    assert port.list() == []
    # an allowed author's PR that mentions the handle: the automation's item replaces the default one
    pr = {**github_payload()["pull_request"], "body": "@payments please look"}
    assert post(github_payload(pull_request=pr), "d3").status_code == 202
    [item] = port.list()
    assert port.drafts[item.id].automation == "review" and item.source.thread_ref == "acme/payments#9"
    # paused: still matched, so the default routing does not quietly take over
    engine.set_paused("review", True)
    assert post(github_payload(pull_request={**pr, "number": 10}), "d4").status_code == 202
    assert len(port.list()) == 1
