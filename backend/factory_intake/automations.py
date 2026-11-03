"""Automations (ADR 0062): a trigger plus filters decide which events start work and which agent handles it.

An automation never grants anything: it filters, routes and carries the owner's own prompt. The prompt is TRUSTED (owner-written, versioned
in the definition) and travels as ``instructions``; whatever the event carries stays untrusted ``body``. State (paused, history, last
schedule check) is local SQLite. Missed schedule slots while the app was closed are skipped: at most the single most recent one fires.
"""
from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.error import YAMLError

from sandbox.secrets import redact

from .cron import Cron, CronError, parse_cron
from .matching import PatternError, check_pattern, match_field, match_payload
from .pipeline import deliver
from .port import MAX_BODY, TERMINAL, FactoryPort, SourceRef, clamp_draft

_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
MAX_FILE_BYTES = 256 * 1024
GITHUB_FILTERS = {"repos", "labels", "authors", "base_branches", "actions", "skip_bots"}
WEBHOOK_FILTERS = {"webhooks", "payload"}
EVENTS = {"github": {"issues", "pull_request", "issue_comment", "pull_request_review_comment"}, "webhook": {"received"}, "schedule": {"cron_fired"}}


class AutomationError(ValueError):
    """An automation file is invalid; names the file and field, never a value."""


@dataclass(frozen=True)
class Trigger:
    provider: str
    event: str
    filter: dict
    name: str | None = None      # schedule name
    cron: Cron | None = None


@dataclass(frozen=True)
class Automation:
    id: str
    title: str
    agent: str
    enabled: bool
    triggers: tuple[Trigger, ...]
    prompt: str
    tokens_per_run: int | None = None
    tokens_per_day: int | None = None
    max_open: int = 1


@dataclass(frozen=True)
class Event:
    provider: str
    event: str
    fields: dict = field(default_factory=dict)   # provider filter inputs (repo, labels, authors, ...)
    payload: object = None
    key: str = ""                                # what makes this delivery the same as a repeat of it
    ref: str = ""                                # the thread or occurrence the resulting item belongs to
    title: str = ""
    body: str = ""
    url: str | None = None


def parse_automation(auto_id: str, text: str) -> Automation:
    where = f"automations/{auto_id}/automation.md"
    if not _ID.fullmatch(auto_id):
        raise AutomationError(f"{where}: the directory name must be lowercase letters, digits and '-'")
    if len(text.encode("utf-8")) > MAX_FILE_BYTES:
        raise AutomationError(f"{where}: file is too large")
    match = re.fullmatch(r"---\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n(.*))?", text, re.DOTALL)
    if not match:
        raise AutomationError(f"{where}: expected YAML frontmatter between '---' lines, then the prompt")
    try:
        data = YAML(typ="safe").load(match.group(1)) or {}
    except YAMLError:
        raise AutomationError(f"{where}: frontmatter is not valid YAML") from None
    if not isinstance(data, dict) or set(data) - {"enabled", "title", "agent", "triggers", "limits"}:
        raise AutomationError(f"{where}: unknown or malformed top-level keys")
    prompt = (match.group(2) or "").strip()
    if redact(text)[1]:
        raise AutomationError(f"{where}: a value looks like a credential; keep secrets in the secrets store")
    enabled, agent, title = data.get("enabled", True), data.get("agent", "foreman"), data.get("title", auto_id)
    if not isinstance(enabled, bool) or not isinstance(agent, str) or not _ID.fullmatch(agent) or not isinstance(title, str) or not title.strip():
        raise AutomationError(f"{where}: enabled, agent or title is invalid")
    raw = data.get("triggers")
    if not isinstance(raw, list) or not raw or len(raw) > 20:
        raise AutomationError(f"{where}: triggers must be a list of 1-20 triggers")
    triggers = tuple(_trigger(where, t) for t in raw)
    limits = data.get("limits") or {}
    if not isinstance(limits, dict) or set(limits) - {"tokensPerRun", "tokensPerDay", "maxOpen"} or any(not isinstance(v, int) or isinstance(v, bool) or v < 1 for v in limits.values()):
        raise AutomationError(f"{where}: limits take positive integers: tokensPerRun, tokensPerDay, maxOpen")
    if not prompt and any(t.provider == "schedule" for t in triggers):
        raise AutomationError(f"{where}: a scheduled automation needs a prompt (nothing else says what to do)")
    return Automation(auto_id, title.strip()[:300], agent, enabled, triggers, prompt[:MAX_BODY], limits.get("tokensPerRun"), limits.get("tokensPerDay"), min(limits.get("maxOpen", 1), 50))


def _trigger(where: str, raw) -> Trigger:
    if not isinstance(raw, dict) or set(raw) - {"provider", "event", "filter", "schedule"}:
        raise AutomationError(f"{where}: a trigger takes provider, event, filter and (schedule) schedule")
    provider, event, flt = raw.get("provider"), raw.get("event"), raw.get("filter") or {}
    if provider not in EVENTS or event not in EVENTS[provider]:
        raise AutomationError(f"{where}: unsupported trigger {provider}/{event}")
    if not isinstance(flt, dict):
        raise AutomationError(f"{where}: filter must be a mapping")
    allowed = {"github": GITHUB_FILTERS, "webhook": WEBHOOK_FILTERS, "schedule": set()}[provider]
    if set(flt) - allowed:
        raise AutomationError(f"{where}: {provider} filters are {', '.join(sorted(allowed)) or 'none'}")
    if provider == "webhook" and not (isinstance(flt.get("webhooks"), list) and flt["webhooks"]):
        raise AutomationError(f"{where}: a webhook trigger needs webhooks: [names]")
    for key, rule in flt.items():
        if key == "payload":
            continue
        if key == "skip_bots":
            if rule not in ("all", "none"):
                raise AutomationError(f"{where}: skip_bots is 'all' or 'none'")
        elif not _string_rule(rule):
            raise AutomationError(f"{where}: filter {key} takes a list of strings, or an object with in/not_in lists of strings")
    try:
        if "payload" in flt:
            check_pattern(flt["payload"])
    except PatternError as exc:
        raise AutomationError(f"{where}: {exc}") from None
    if provider == "github":  # the event fields are lowercased, so the rules are too
        low = lambda v: v.lower() if isinstance(v, str) else [low(x) for x in v] if isinstance(v, list) else {k: low(x) for k, x in v.items()} if isinstance(v, dict) else v  # noqa: E731
        flt = {k: (low(v) if k in ("repos", "labels", "authors") else v) for k, v in flt.items()}
    if provider != "schedule":
        if "schedule" in raw:
            raise AutomationError(f"{where}: schedule only belongs to provider schedule")
        return Trigger(provider, event, flt)
    sched = raw.get("schedule")
    if not isinstance(sched, dict) or set(sched) - {"name", "cron", "timezone"} or not _ID.fullmatch(str(sched.get("name", ""))):
        raise AutomationError(f"{where}: schedule takes name (lowercase-with-dashes), cron and optional timezone")
    try:
        cron = parse_cron(str(sched.get("cron", "")), sched.get("timezone"))
    except CronError as exc:
        raise AutomationError(f"{where}: {exc}") from None
    return Trigger(provider, event, flt, sched["name"], cron)


def _string_rule(rule) -> bool:
    lst = lambda v: isinstance(v, list) and all(isinstance(x, str) and x for x in v)  # noqa: E731
    if isinstance(rule, list):
        return lst(rule)
    return isinstance(rule, dict) and bool(rule) and set(rule) <= {"in", "not_in"} and all(lst(v) for v in rule.values())


def load_automations(directory: Path) -> dict[str, Automation]:
    root = Path(directory) / "automations"
    found: dict[str, Automation] = {}
    if root.is_dir():
        for folder in sorted(p for p in root.iterdir() if p.is_dir()):
            file = folder / "automation.md"
            if not file.exists():
                raise AutomationError(f"automations/{folder.name}: missing automation.md")
            if file.is_symlink() or folder.is_symlink():
                raise AutomationError(f"automations/{folder.name}: symbolic links are not followed")
            try:
                if file.stat().st_size > MAX_FILE_BYTES:
                    raise AutomationError(f"automations/{folder.name}/automation.md: file is too large")
                text = file.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                raise AutomationError(f"automations/{folder.name}/automation.md: cannot be read as UTF-8 text") from None
            found[folder.name] = parse_automation(folder.name, text)
    return found


# -- matching -----------------------------------------------------------------------------------------------------------------------
def trigger_matches(trigger: Trigger, event: Event) -> bool:
    if (trigger.provider, trigger.event) != (event.provider, event.event):
        return False
    flt = trigger.filter
    if trigger.provider == "schedule":
        return trigger.name == event.fields.get("schedule")
    if trigger.provider == "webhook":
        return event.fields.get("webhook") in flt.get("webhooks", []) and ("payload" not in flt or match_payload(flt["payload"], event.payload))
    if flt.get("skip_bots", "all") in ("all", True) and event.fields.get("bot"):
        return False  # bots are skipped unless the automation opts in with skip_bots: none
    return all(match_field(flt[key], event.fields.get(field_name)) for key, field_name in
               (("repos", "repo"), ("labels", "labels"), ("authors", "author"), ("base_branches", "base_branch"), ("actions", "action")) if key in flt)


# -- state --------------------------------------------------------------------------------------------------------------------------
class AutomationEngine:
    def __init__(self, port: FactoryPort, automations: dict[str, Automation], db_path: str | Path, clock=time.time):
        self.port, self.automations, self._clock = port, automations, clock
        self._db = sqlite3.connect(str(db_path), check_same_thread=False)
        self._lock = threading.RLock()
        with self._db:
            self._db.execute("CREATE TABLE IF NOT EXISTS automation_paused (id TEXT PRIMARY KEY)")
            self._db.execute("CREATE TABLE IF NOT EXISTS automation_checked (name TEXT PRIMARY KEY, at REAL)")
            self._db.execute("CREATE TABLE IF NOT EXISTS automation_items (automation TEXT, item TEXT, at REAL, closed INTEGER DEFAULT 0, PRIMARY KEY (automation, item))")
            self._db.execute("CREATE TABLE IF NOT EXISTS automation_history (id INTEGER PRIMARY KEY, at REAL, automation TEXT, trigger TEXT, outcome TEXT, item TEXT, reason TEXT)")

    # pause / resume / history
    def set_paused(self, auto_id: str, paused: bool) -> None:
        if auto_id not in self.automations:
            raise KeyError(auto_id)
        with self._lock, self._db:
            self._db.execute("INSERT OR IGNORE INTO automation_paused VALUES (?)" if paused else "DELETE FROM automation_paused WHERE id = ?", (auto_id,))

    def is_paused(self, auto_id: str) -> bool:
        with self._lock:
            return self._db.execute("SELECT 1 FROM automation_paused WHERE id = ?", (auto_id,)).fetchone() is not None

    def _log(self, auto_id: str, trigger: str, outcome: str, item: str | None = None, reason: str = "") -> None:
        with self._lock, self._db:
            self._db.execute("INSERT INTO automation_history (at, automation, trigger, outcome, item, reason) VALUES (?,?,?,?,?,?)", (self._clock(), auto_id, trigger, outcome, item, reason[:300]))
            self._db.execute("DELETE FROM automation_history WHERE id NOT IN (SELECT id FROM automation_history ORDER BY id DESC LIMIT 5000)")

    def history(self, auto_id: str | None = None, limit: int = 50) -> list[dict]:
        query, args = "SELECT at, automation, trigger, outcome, item, reason FROM automation_history", []
        if auto_id:
            query, args = query + " WHERE automation = ?", [auto_id]
        with self._lock:
            rows = self._db.execute(query + " ORDER BY id DESC LIMIT ?", (*args, limit)).fetchall()
        return [dict(zip(("at", "automation", "trigger", "outcome", "item", "reason"), r)) for r in rows]

    # firing
    def _fire(self, auto: Automation, trigger: Trigger, event: Event) -> tuple[str | None, bool]:
        """(item id or None, handled). ``handled`` is False only for an error worth retrying; skips and replays are handled outcomes."""
        label = f"{trigger.provider}/{trigger.name or trigger.event}"
        if not auto.enabled or self.is_paused(auto.id):
            self._log(auto.id, label, "skipped_paused", reason="paused" if auto.enabled else "disabled")
            return None, True
        if trigger.provider == "schedule" and self._open_items(auto.id) >= auto.max_open:  # only schedules do not stack: events are separate threads
            self._log(auto.id, label, "skipped_open", reason=f"{auto.max_open} item(s) from this automation still open")
            return None, True
        if auto.tokens_per_day is not None and self._spent_today(auto.id) >= auto.tokens_per_day:
            self._log(auto.id, label, "skipped_budget", reason="tokensPerDay reached")
            return None, True
        kind = trigger.provider
        # a GitHub automation gets an item of its own on the thread (so its agent, prompt and ceiling apply even if the thread already has an
        # item); replies still go to the thread through thread_ref
        ref = f"{event.ref}~{auto.id}" if kind == "github" else event.ref
        try:
            draft = clamp_draft(SourceRef(kind=kind, ref=ref[:200], url=event.url, thread_ref=event.ref if kind == "github" else None), event.title or auto.title, event.body, [],
                                f"automation:{auto.id}", f"auto:{auto.id}:{event.key}"[:200])
            draft = draft.model_copy(update={"agent": auto.agent, "automation": auto.id, "instructions": auto.prompt, "token_ceiling": auto.tokens_per_run})
            delivered = deliver(self.port, draft)
        except Exception as exc:  # one failing delivery must not stop the others; the reason is recorded without request content
            self._log(auto.id, label, "error", reason=type(exc).__name__)
            return None, False
        if delivered.outcome == "replay":
            return None, True
        with self._lock, self._db:
            self._db.execute("INSERT OR IGNORE INTO automation_items (automation, item, at) VALUES (?,?,?)", (auto.id, delivered.item.id, self._clock()))
        self._log(auto.id, label, "fired" if delivered.outcome == "created" else "followup", delivered.item.id)
        return delivered.item.id, True

    def _open_items(self, auto_id: str) -> int:
        with self._lock:
            rows = self._db.execute("SELECT item FROM automation_items WHERE automation = ? AND closed = 0", (auto_id,)).fetchall()
        count = 0
        for (item_id,) in rows:
            try:
                if self.port.get(item_id).state in TERMINAL:
                    with self._lock, self._db:
                        self._db.execute("UPDATE automation_items SET closed = 1 WHERE automation = ? AND item = ?", (auto_id, item_id))
                else:
                    count += 1
            except Exception:
                continue
        return count

    def _spent_today(self, auto_id: str) -> int:
        with self._lock:
            rows = self._db.execute("SELECT item FROM automation_items WHERE automation = ? AND at >= ?", (auto_id, self._clock() - 86400)).fetchall()
        total = 0
        for (item_id,) in rows:
            try:
                total += self.port.get(item_id).cost_tokens
            except Exception:
                continue
        return total

    def handle(self, event: Event) -> list[str]:
        """Fire every enabled automation whose trigger matches the event. Returns the ids of the items it started."""
        return self.dispatch(event)[0]

    def dispatch(self, event: Event) -> tuple[list[str], bool]:
        """(started item ids, whether any automation matched). A match counts even when the automation was paused or over budget: the
        owner routed this kind of event to it, so the default routing must not quietly take over."""
        started, matched = [], False
        for auto in self.automations.values():
            for trigger in auto.triggers:
                if trigger_matches(trigger, event):
                    matched = True
                    item, _ = self._fire(auto, trigger, event)
                    if item:
                        started.append(item)
                    break  # one fire per automation per event, however many of its triggers match
        return started, matched

    def explain(self, event: Event) -> list[dict]:
        """Test filter: what each automation would do with this event, with nothing created or logged."""
        out = []
        for auto in self.automations.values():
            hit = any(trigger_matches(t, event) for t in auto.triggers)
            out.append({"automation": auto.id, "matches": hit, "active": auto.enabled and not self.is_paused(auto.id)})
        return out

    # schedule
    def tick(self, now: datetime | None = None) -> list[str]:
        """Start the schedule slots that came due since the last tick. The first tick only records the time (nothing fires retroactively)."""
        now = (now or datetime.fromtimestamp(self._clock(), timezone.utc)).astimezone(timezone.utc)
        started = []
        for auto in self.automations.values():
            for trigger in auto.triggers:
                if trigger.provider != "schedule" or trigger.cron is None:
                    continue
                name = f"{auto.id}/{trigger.name}"
                with self._lock:
                    row = self._db.execute("SELECT at FROM automation_checked WHERE name = ?", (name,)).fetchone()
                handled = True
                if row is not None and (slot := trigger.cron.latest(datetime.fromtimestamp(row[0], timezone.utc), now)) is not None:
                    stamp = slot.strftime("%Y-%m-%dT%H:%MZ")
                    item, handled = self._fire(auto, trigger, Event("schedule", "cron_fired", {"schedule": trigger.name}, key=f"{trigger.name}@{stamp}", ref=f"{auto.id}@{stamp}", title=auto.title))
                    if item:
                        started.append(item)
                if handled:  # on an error the floor stays, so the next tick retries this slot (the slot's key makes a retry safe)
                    with self._lock, self._db:
                        self._db.execute("INSERT OR REPLACE INTO automation_checked VALUES (?,?)", (name, now.timestamp()))
        return started

    def close(self) -> None:
        self._db.close()


def webhook_event(name: str, payload, key: str) -> Event:
    return Event("webhook", "received", {"webhook": name}, payload, key=f"{name}:{key}", ref=f"{name}:{key[:60]}", title=f"Webhook {name}",
                 body="event-payload (untrusted):\n" + redact(json.dumps(payload, ensure_ascii=False)[:MAX_BODY])[0])


def github_event(event: str, payload: dict, trigger_id: str) -> Event | None:
    """The filter inputs of a GitHub delivery, or None if it is not shaped as expected."""
    try:
        repo = payload["repository"]["full_name"].lower()
        item = payload.get("pull_request") or payload.get("issue")
        number = item["number"]
        sender = payload.get("sender") or {}
        comment = payload.get("comment") if isinstance(payload.get("comment"), dict) else None
        if type(number) is not int:
            return None
        fields = {"repo": repo, "labels": [str(l.get("name", "")).lower() for l in item.get("labels", []) if isinstance(l, dict)], "author": str(sender.get("login", "")).lower(),
                  "action": payload.get("action"), "bot": str(sender.get("type", "")).lower() == "bot" or str(sender.get("login", "")).lower().endswith("[bot]"),
                  "base_branch": (item.get("base") or {}).get("ref") if isinstance(item.get("base"), dict) else None}
    except (KeyError, TypeError, AttributeError):
        return None
    thread = f"{repo}#{number}"
    return Event("github", event, fields, payload, key=f"{thread}:{trigger_id}", ref=thread, title=str(item.get("title") or "")[:300],
                 body=str((comment or item).get("body") or "")[:MAX_BODY], url=item.get("html_url"))
