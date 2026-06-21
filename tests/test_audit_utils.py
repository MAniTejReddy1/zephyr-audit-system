import unittest

from audit_utils import build_audit_snapshot, diff_changed_fields, hash_data, sanitize_for_storage
from poller import classify_action


class AuditUtilsTest(unittest.TestCase):
    def test_test_steps_affect_hash(self):
        case_data = {
            "key": "QA-T1",
            "name": "Checkout",
            "status": {"id": 1, "name": "Draft"},
            "labels": ["smoke"],
        }
        before = build_audit_snapshot(case_data, "CEFI > Trading", [{"step": "Open app"}])
        after = build_audit_snapshot(case_data, "CEFI > Trading", [{"step": "Open app"}, {"step": "Pay"}])

        self.assertNotEqual(hash_data(before), hash_data(after))
        self.assertEqual(diff_changed_fields(before, after), ["testSteps"])

    def test_sensitive_values_are_redacted(self):
        payload = {
            "name": "Case",
            "apiToken": "abc",
            "nested": {"password": "secret", "safe": "value"},
        }

        self.assertEqual(
            sanitize_for_storage(payload),
            {"name": "Case", "apiToken": "[REDACTED]", "nested": {"password": "[REDACTED]", "safe": "value"}},
        )

    def test_archive_status_transition_is_classified(self):
        action, reason = classify_action(
            previous_folder_id=1,
            current_folder_id=1,
            previous_status="Active",
            current_status="Archived",
            previous_folder_path="CEFI > Trading",
            current_folder_path="CEFI > Trading",
            was_deleted=False,
        )

        self.assertEqual(action, "ARCHIVED")
        self.assertIsNone(reason)

    def test_folder_transition_is_classified_as_move(self):
        action, reason = classify_action(
            previous_folder_id=1,
            current_folder_id=2,
            previous_status="Active",
            current_status="Active",
            previous_folder_path="CEFI > Trading",
            current_folder_path="CEFI > Futures",
            was_deleted=False,
        )

        self.assertEqual(action, "MOVED")
        self.assertEqual(reason, "folder")

    def test_restored_action_when_previously_deleted(self):
        action, reason = classify_action(
            previous_folder_id=1,
            current_folder_id=1,
            previous_status="Active",
            current_status="Active",
            previous_folder_path="CEFI > Trading",
            current_folder_path="CEFI > Trading",
            was_deleted=True,
        )

        self.assertEqual(action, "RESTORED")
        self.assertIsNone(reason)

    def test_archive_folder_path_detection(self):
        action, reason = classify_action(
            previous_folder_id=1,
            current_folder_id=2,
            previous_status="Active",
            current_status="Active",
            previous_folder_path="CEFI > Trading",
            current_folder_path="CEFI > Archived > Old Tests",
            was_deleted=False,
        )

        self.assertEqual(action, "ARCHIVED")
        self.assertIsNone(reason)


if __name__ == "__main__":
    unittest.main()
