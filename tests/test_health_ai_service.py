import json
import unittest
from unittest.mock import Mock, patch

from f5_automation.health.health_ai_service import (
    GoviLLMConfig,
    HealthAIError,
    HealthAIService,
    analyze_with_fallback,
)


class HealthAIServiceTests(unittest.TestCase):
    def config(self, endpoint="https://llm.example/v1"):
        return GoviLLMConfig(endpoint, "llm-secret", "govi-model")

    def test_sends_only_allowlisted_health_facts(self):
        session = Mock()
        response = Mock()
        response.json.return_value = {"choices": [{"message": {"content": json.dumps({
            "executive_summary": "Ambiente estável.",
            "device_diagnostics": {"f5-a": "Sem exaustão."},
            "action_plan": [],
        })}}]}
        session.post.return_value = response

        result = HealthAIService(self.config(), session=session).analyze([{
            "hostname": "f5-a", "cpu_tmm": 12, "password": "never-send",
            "log_alerts": ["raw sensitive log"],
        }])

        sent = session.post.call_args.kwargs["json"]
        user_payload = sent["messages"][1]["content"]
        self.assertNotIn("never-send", user_payload)
        self.assertNotIn("raw sensitive log", user_payload)
        self.assertEqual(result["executive_summary"], "Ambiente estável.")

    def test_uses_azure_govi_configuration(self):
        service = HealthAIService(self.config("https://company.openai.azure.com"), session=Mock())
        self.assertIn("/deployments/govi-model/chat/completions", service._completion_url())
        self.assertEqual(service._headers()["api-key"], "llm-secret")

    def test_falls_back_when_shared_configuration_is_missing(self):
        with patch.object(GoviLLMConfig, "from_settings", side_effect=HealthAIError("missing")):
            result = analyze_with_fallback([{"hostname": "f5-a", "cpu_tmm": 99}])
        self.assertEqual(result["source"], "Classificação local")
        self.assertEqual(result["action_plan"][0]["title"], "CPU TMM exausta")

    def test_rejects_unstructured_model_response(self):
        session = Mock()
        response = Mock()
        response.json.return_value = {"choices": [{"message": {"content": "não é JSON"}}]}
        session.post.return_value = response
        with self.assertRaises(HealthAIError):
            HealthAIService(self.config(), session=session).analyze([])


if __name__ == "__main__":
    unittest.main()
