"""Static and shell-contract tests for the Azure standalone APK build."""
from __future__ import annotations

import json
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIPELINE = ROOT / "azure-pipelines-apk.yml"
BUILD_SCRIPT = ROOT / "mobile-app/ci/build-azure-apk.sh"
DOC = ROOT / "docs/APK-AZURE.md"
APP_CONFIG = ROOT / "mobile-app/app.json"


class AzureStandaloneApkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pipeline = PIPELINE.read_text(encoding="utf-8")
        cls.script = BUILD_SCRIPT.read_text(encoding="utf-8")
        cls.doc = DOC.read_text(encoding="utf-8")

    def test_shell_script_has_valid_bash_syntax(self) -> None:
        result = subprocess.run(["bash", "-n", str(BUILD_SCRIPT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_pipeline_references_script_and_publishes_artifact(self) -> None:
        self.assertIn("vmImage: ubuntu-24.04", self.pipeline)
        self.assertIn("NodeTool@0", self.pipeline)
        self.assertIn("20.19.x", self.pipeline)
        self.assertIn("JavaToolInstaller@0", self.pipeline)
        self.assertIn("filePath: mobile-app/ci/build-azure-apk.sh", self.pipeline)
        self.assertIn("PublishPipelineArtifact@1", self.pipeline)
        self.assertIn("artifact: 'FashionStore-APK'", self.pipeline)

    def test_build_uses_release_variant_not_metro_dependent_debug(self) -> None:
        self.assertIn(":app:assembleRelease", self.script)
        self.assertNotIn(":app:assembleDebug", self.script)
        self.assertIn("assets/index.android.bundle", self.script)
        self.assertIn("EAS_BUILD_PROFILE=azure", self.script)

    def test_release_variant_is_signed_and_verified(self) -> None:
        self.assertIn("keytool -genkeypair", self.script)
        self.assertIn("fashionstore-ci-signing.gradle", self.script)
        self.assertIn('"$APKSIGNER" verify', self.script)
        self.assertIn('"$ZIPALIGN" -c -v 4', self.script)

    def test_build_embeds_configured_production_api(self) -> None:
        self.assertIn("EXPO_PUBLIC_API_URL", self.pipeline)
        self.assertIn("$API_BASE_URL/health", self.script)
        self.assertIn("body.estado !== 'ok'", self.script)
        self.assertIn('grep -aFq "$API_BASE_URL"', self.script)

    def test_build_checks_package_and_metadata(self) -> None:
        app = json.loads(APP_CONFIG.read_text(encoding="utf-8"))["expo"]
        self.assertEqual(app["android"]["package"], "bo.fashionstore.app")
        self.assertIn("versionCode", app["android"])
        self.assertIn('grep -Fq "package: name=\'$EXPECTED_PACKAGE\'"', self.script)
        self.assertIn("APK_SHA256", self.script)
        self.assertIn("INFORMACION-BUILD.txt", self.script)

    def test_invalid_api_fails_before_expensive_build_steps(self) -> None:
        self.assertLess(self.script.index('[[ -n "$API_BASE_URL" ]]'), self.script.index("npm ci"))
        self.assertLess(self.script.index("$API_BASE_URL/health"), self.script.index("npm ci"))

    def test_pipeline_documentation_explains_ephemeral_signing(self) -> None:
        self.assertIn("clave temporal", self.doc)
        self.assertIn("assets/index.android.bundle", self.doc)
        self.assertIn("Secure File", self.doc)

    def test_pipeline_yaml_parses(self) -> None:
        try:
            import yaml
        except ImportError:
            self.skipTest("PyYAML no disponible")
        # Azure macros remain plain scalar strings; PyYAML 1.1 parses this structure.
        data = yaml.safe_load(self.pipeline)
        self.assertIn("pool", data)
        self.assertEqual(data["pool"]["vmImage"], "ubuntu-24.04")
        self.assertTrue(any(step.get("task") == "PublishPipelineArtifact@1" for step in data["steps"]))

    def test_expo_sdk_54_build_toolchain_versions_are_pinned(self) -> None:
        package = json.loads((ROOT / "mobile-app/package.json").read_text(encoding="utf-8"))
        self.assertTrue(package["dependencies"]["expo"].startswith("~54."))
        self.assertIn('"ndk;27.1.12297006"', self.script)
        self.assertIn('"platforms;android-36"', self.script)
        self.assertIn('"build-tools;36.0.0"', self.script)


if __name__ == "__main__":
    unittest.main(verbosity=2)
