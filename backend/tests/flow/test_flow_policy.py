from __future__ import annotations

import unittest

from flow.policy import (
    FLOW_QUESTIONS,
    Facts,
    Perception,
    advise,
    advise_facts,
    describe,
    laya_payload,
    perception_from_laya,
)


def _seen(**overrides: float | str | None) -> Perception:
    base: dict[str, float | str | None | bool] = {
        "band": "matched",
        "band_confidence": 0.9,
        "stop": 0.05,
        "unsafe": 0.05,
        "disagree": 0.05,
        "has_easier": True,
        "has_harder": True,
    }
    base.update(overrides)
    return Perception(**base)  # type: ignore[arg-type]


class FlowPolicyTest(unittest.TestCase):
    def test_matched_acts_once(self) -> None:
        advice = advise_facts(Facts("matched"))
        self.assertEqual(advice.action, "act")
        self.assertTrue(advice.takes_step)

    def test_too_hard_plans_once_toward_easier(self) -> None:
        advice = advise_facts(Facts("too_hard"))
        self.assertEqual((advice.action, advice.neighbor), ("plan_once", "easier"))

    def test_too_easy_raises_toward_harder(self) -> None:
        advice = advise_facts(Facts("too_easy"))
        self.assertEqual((advice.action, advice.neighbor), ("raise", "harder"))

    def test_missing_neighbor_is_requested(self) -> None:
        harder = advise_facts(Facts("too_easy", has_harder=False))
        easier = advise_facts(Facts("too_hard", has_easier=False))
        self.assertEqual(harder.action, "request_neighbor")
        self.assertEqual(easier.neighbor, "easier")
        self.assertFalse(harder.takes_step)
        self.assertFalse(easier.takes_step)

    def test_no_signal_and_interrupt_still_act(self) -> None:
        self.assertEqual(advise_facts(Facts("no_signal")).action, "act")
        self.assertEqual(advise_facts(Facts("interrupted")).reason, "resume the same task")

    def test_public_checks_passed_closes(self) -> None:
        advice = advise_facts(Facts("too_easy", goal_met=True))
        self.assertEqual(advice.action, "close")
        self.assertFalse(advice.takes_step)

    def test_stop_and_unsafe_close_without_a_step(self) -> None:
        for facts in (Facts("matched", stop=True), Facts("matched", unsafe=True)):
            advice = advise_facts(facts)
            self.assertEqual(advice.action, "close")
            self.assertFalse(advice.takes_step)

    def test_unsafe_wins_over_a_matched_band(self) -> None:
        advice = advise(_seen(unsafe=0.8))
        self.assertEqual(advice.reason, "next step is unsafe")

    def test_disagreement_blocks(self) -> None:
        advice = advise_facts(Facts("matched", attention_matches_progress=False))
        self.assertEqual(advice.action, "block")

    def test_low_band_confidence_abstains(self) -> None:
        advice = advise(_seen(band="too_hard", band_confidence=0.4))
        self.assertEqual(advice.action, "abstain")

    def test_describe_states_the_conclusion_without_digits(self) -> None:
        text = describe(Facts("too_hard", unsafe=True))
        self.assertIn("unsafe", text)
        self.assertIn("harder than current skill", text)
        self.assertFalse(any(character.isdigit() for character in text))

    def test_payload_rejects_numbers_and_asks_perception(self) -> None:
        payload = laya_payload(describe(Facts("matched")))
        self.assertEqual(payload["questions"], FLOW_QUESTIONS)
        self.assertNotIn("should", FLOW_QUESTIONS["band"]["instructions"])
        with self.assertRaises(ValueError):
            laya_payload("progress 80 of 100")

    def test_laya_answers_round_trip(self) -> None:
        perception = perception_from_laya(
            {
                "band": {"choice": "too_easy", "confidence": 0.91},
                "stop": {"noul": 0.02},
                "unsafe": {"noul": 0.01},
                "disagree": {"noul": 0.04},
            },
            has_harder=False,
        )
        advice = advise(perception)
        self.assertEqual(advice.action, "request_neighbor")
        self.assertEqual(advice.neighbor, "harder")


if __name__ == "__main__":
    unittest.main()
