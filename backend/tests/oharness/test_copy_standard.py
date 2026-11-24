"""Copy standard: everything the app ships is a "harness".

The product never calls a bundled harness a "framework", a "sample", a
"template", a "preset" or a "Copilot" (the assistant is Nilo). The source a
harness is modelled on may still be cited in its description
(``skills-framework``, ``deepseek-ai/deepseek-harness``, ``mattpocock/skills``).
See GLOSSARY in CONTEXT.md.
"""

from __future__ import annotations

import hashlib
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


MODES_JSON = BACKEND_DIR / "sandbox" / "permission_modes.json"
MODE_STRINGS = [
    (f"{mode['id']}.{field}", mode[field])
    for mode in json.loads(MODES_JSON.read_text(encoding="utf-8"))["modes"]
    for field in ("label", "summary", "hint", "denyNote")
]


@pytest.mark.parametrize(("field", "text"), MODE_STRINGS, ids=[f for f, _ in MODE_STRINGS])
def test_permission_mode_strings_use_no_forbidden_term(field, text):
    """Refusal notes and hints are read in the chat: the UI calls these "modes"."""
    assert not FORBIDDEN.search(text), f"{field}: {text!r}"


# sha256 of lowercase third-party app names. The plaintext stays out of the source.
_APP_NAME_HASHES = {
    "60965168ce762e949600281ba6d01fee136e5b6e8257b1f216f9025ed324474c",
    "5d72436256ada53828b51895a94bb8489e9f1ac4fe937a8024ef1594e7045ff6",
    "9058f79c893a1d7e20b13009b95b9cf3211478a91a47e2ad65bdfedad6fc98f4",
    "45d780f82c9247fc1142f8b60c12b6c6cd3d9f23dd836cfa6e84c498d2f83292",
    "6db7636b5922f26c1eb855fda18da3c40913d6237e21a90fb155b85868b9bfde",
    "81ed341348bed14c507f31afb5d1afed2262e97378012e59f5e9e03e4e6ecd38",
    "7764735c5d4d88ae3ef1c0d6c0a5769e4187c341895db19a82ba7d4e17b8c914",
    "0e3ef6d103af163dcdffe26b76485f38af7f1d697ce05034c107de73eff16afb",
}
_TOKEN = re.compile(r"[a-z0-9]+")


def _cited_app(text: str) -> str | None:
    for token in _TOKEN.findall(text.lower()):
        digest = hashlib.sha256(token.encode()).hexdigest()
        if digest in _APP_NAME_HASHES:
            return digest
    return None


def _nilo_copy() -> list[str]:
    texts: list[str] = []
    nilo = BACKEND_DIR / "nilo"
    if nilo.is_dir():
        for path in sorted(nilo.rglob("*")):
            if path.suffix == ".py" and path.is_file():
                texts.append(path.read_text(encoding="utf-8"))
    frontend = BACKEND_DIR.parent / "frontend" / "src"
    ui = frontend / "nilo"
    if ui.is_dir():
        for path in sorted(ui.rglob("*")):
            if path.suffix in {".ts", ".tsx"} and path.is_file():
                texts.append(path.read_text(encoding="utf-8"))
    for catalog in (frontend / "i18n").glob("messages*.ts"):
        for line in catalog.read_text(encoding="utf-8").splitlines():
            if '"nilo.' in line:
                texts.append(line)
    return texts


def test_nilo_copy_cites_no_other_app_and_uses_none_of_the_retired_words():
    for text in _nilo_copy():
        visible = CITATION.sub("", text)
        assert FORBIDDEN.search(visible) is None
        assert _cited_app(text) is None
