"""#341: Windows ships no IANA time-zone database; automations name zones, so `tzdata` must be installed and packaged."""
import re
from pathlib import Path

from factory_intake.cron import parse_cron

BACKEND = Path(__file__).resolve().parents[1]


def test_tzdata_is_a_pinned_runtime_requirement():
    lines = (BACKEND / "requirements.txt").read_text(encoding="utf-8").splitlines()
    assert any(re.fullmatch(r"tzdata==\d[\w.]*", line.strip()) for line in lines)


def test_the_sidecar_bundle_carries_the_tzdata_files():
    build = (BACKEND.parent / "scripts" / "build-sidecar.mjs").read_text(encoding="utf-8")
    assert '"--collect-data", "tzdata"' in build


def test_a_named_zone_schedules_without_the_system_database():
    cron = parse_cron("0 9 * * *", "America/Sao_Paulo")
    assert cron.zone is not None and cron.zone.key == "America/Sao_Paulo"
    assert parse_cron("0 9 * * *", "UTC").zone.key == "UTC"
