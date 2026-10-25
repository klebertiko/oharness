"""Copy standard: everything the app ships is a "harness".

The product never calls a bundled harness a "framework", a "sample", a
"template", a "preset" or a "Copilot" (the assistant is Nilo). The source a
harness is modelled on may still be cited in its description
(``skills-framework``, ``deepseek-ai/deepseek-harness``, ``mattpocock/skills``).
See GLOSSARY in CONTEXT.md.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from oharness import codec, examples

BACKEND_DIR = Path(__file__).resolve().parents[2]
RESOURCES = BACKEND_DIR.parent / "src-tauri" / "resources"

FORBIDDEN = re.compile(r"framework|sample|template|preset|copilot", re.IGNORECASE)
# The one allowed use of "framework": citing the source project by its name.
CITATION = re.compile(r"skills-framework", re.IGNORECASE)


def _manifests() -> list[tuple[str, dict]]:
    out = [(f"fixture:{e.path.name}", codec.load_path(e.path)["manifest"]) for e in examples.list_examples()]
    for path in sorted(RESOURCES.glob("*.oharness")):
        out.append((f"resource:{path.name}", json.loads(path.read_text(encoding="utf-8"))["manifest"]))
    return out


MANIFESTS = _manifests()
IDS = [label for label, _ in MANIFESTS]


def test_manifests_were_found():
    assert len([i for i in IDS if i.startswith("fixture:")]) == 3
    assert len([i for i in IDS if i.startswith("resource:")]) == 3


@pytest.mark.parametrize(("label", "manifest"), MANIFESTS, ids=IDS)
def test_name_uses_no_forbidden_term(label, manifest):
    assert not FORBIDDEN.search(manifest["name"]), f"{label}: {manifest['name']!r}"


@pytest.mark.parametrize(("label", "manifest"), MANIFESTS, ids=IDS)
def test_description_uses_no_forbidden_term_outside_a_source_citation(label, manifest):
    text = CITATION.sub("", manifest["description"])
    assert not FORBIDDEN.search(text), f"{label}: {manifest['description']!r}"


@pytest.mark.parametrize(("label", "manifest"), MANIFESTS, ids=IDS)
def test_tags_use_no_forbidden_term(label, manifest):
    for tag in manifest.get("tags", []):
        assert not FORBIDDEN.search(tag), f"{label}: {tag!r}"


def test_default_agile_product_name():
    for label, manifest in MANIFESTS:
        if manifest["id"] == "oharness.default.agile":
            assert manifest["name"] == "Agile Harness", label


# The retired card label "Example harness" (#113): a bundled harness is called a
# "bundled harness" everywhere a person reads it. Ids, tags and the
# /bundles/examples route keep the word `example`; only the phrase is retired.
RETIRED_LABEL = re.compile(r"example harness", re.IGNORECASE)


def test_examples_catalog_served_to_the_ui_never_labels_a_harness_example():
    from fastapi.testclient import TestClient

    from main import app

    items = TestClient(app).get("/bundles/examples").json()["examples"]
    assert len(items) == 3
    for item in items:
        assert not RETIRED_LABEL.search(json.dumps(item, ensure_ascii=False)), item["id"]


@pytest.mark.parametrize("path", sorted(RESOURCES.glob("*.oharness")), ids=lambda p: p.name)
def test_packaged_resources_never_label_a_harness_example(path):
    assert not RETIRED_LABEL.search(path.read_text(encoding="utf-8")), path.name
