import unittest
from unittest.mock import Mock

from f5_automation.health.health_adapter import (
    F5HealthAdapter,
    ReadOnlyViolation,
    build_action_plan,
)


class HealthAdapterTests(unittest.TestCase):
    def test_blocks_every_mutating_http_method(self):
        adapter = F5HealthAdapter("bigip.example", "operator", "secret", session=Mock())
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            with self.subTest(method=method), self.assertRaises(ReadOnlyViolation):
                adapter._request(method, "/mgmt/tm/ltm/virtual")
        adapter.session.get.assert_not_called()

    def test_collect_uses_get_and_does_not_return_credentials(self):
        session = Mock()
        session.headers = {}
        response = Mock()
        response.json.return_value = {}
        session.get.return_value = response
        result = F5HealthAdapter("bigip.example", "operator", "secret", session=session).collect()
        self.assertEqual(session.get.call_count, 8)
        self.assertNotIn("password", result)
        self.assertNotIn("username", result)
        self.assertEqual(result["log_alerts"], [])

    def test_action_plan_is_critical_first(self):
        actions = build_action_plan([
            {"hostname": "f5-a", "disk_var": 91},
            {"hostname": "f5-b", "cpu_tmm": 99},
        ])
        self.assertEqual([item["priority"] for item in actions], ["Crítica", "Média"])


if __name__ == "__main__":
    unittest.main()
