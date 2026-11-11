"""Regresiones para impedir que el panel vuelva a mostrar objetos JSON crudos."""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB_REPORTS = ROOT / "frontend-web/src/pages/panel/Reportes.tsx"
MOBILE_PANEL = ROOT / "mobile-app/src/screens/Panel.tsx"
PIPELINE = ROOT / "azure-pipelines-apk.yml"


class HumanReadablePresentationTests(unittest.TestCase):
    def test_web_ml_page_does_not_render_raw_json(self) -> None:
        source = WEB_REPORTS.read_text(encoding="utf-8")
        self.assertNotIn("<pre", source.lower())
        self.assertNotRegex(source, re.compile(r"JSON\.stringify\s*\("))
        self.assertNotIn("JSON.stringify(ml.", source)
        self.assertIn("MetricasClasificacion", source)
        self.assertIn("Matriz de confusión", source)

    def test_mobile_panel_does_not_render_raw_json(self) -> None:
        source = MOBILE_PANEL.read_text(encoding="utf-8")
        self.assertNotIn("formatRows(", source)
        self.assertNotIn("<pre", source.lower())
        self.assertNotRegex(source, re.compile(r"JSON\.stringify\s*\("))
        self.assertIn("predictionPresentation", source)
        self.assertIn("MetricTile", source)

    def test_no_raw_json_dump_helpers_in_frontend_or_mobile_views(self) -> None:
        roots = [ROOT / "frontend-web/src", ROOT / "mobile-app/src"]
        for root in roots:
            for path in list(root.rglob("*.tsx")) + list(root.rglob("*.jsx")):
                source = path.read_text(encoding="utf-8")
                with self.subTest(path=path.relative_to(ROOT)):
                    self.assertNotIn("<pre", source.lower())
                    # Serializing requests/storage is permitted; dumping JSON inside JSX is not.
                    self.assertNotRegex(source, re.compile(r"\{\s*JSON\.stringify\s*\("))


class AzureApkPipelineTests(unittest.TestCase):
    def test_azure_pipeline_has_real_android_gradle_build_and_artifact(self) -> None:
        source = PIPELINE.read_text(encoding="utf-8")
        build_script = (ROOT / "mobile-app/ci/build-azure-apk.sh").read_text(encoding="utf-8")
        required = (
            "vmImage: ubuntu-24.04",
            "JavaToolInstaller@0",
            "NodeTool@0",
            "EXPO_PUBLIC_API_URL",
            "filePath: mobile-app/ci/build-azure-apk.sh",
            "PublishPipelineArtifact@1",
            "FashionStore-APK",
        )
        for item in required:
            with self.subTest(item=item):
                self.assertIn(item, source)
        self.assertIn(":app:assembleRelease", build_script)
        self.assertNotIn(":app:assembleDebug", build_script)
        self.assertIn('"$APKSIGNER" verify', build_script)
        self.assertIn("assets/index.android.bundle", build_script)

    def test_pipeline_checks_live_api_health_before_build(self) -> None:
        source = (ROOT / "mobile-app/ci/build-azure-apk.sh").read_text(encoding="utf-8")
        self.assertIn("$API_BASE_URL/health", source)
        self.assertIn("body.estado !== 'ok'", source)
        self.assertLess(source.index("$API_BASE_URL/health"), source.index("npm ci"))

    def test_mobile_app_version_was_incremented_for_ui_fix(self) -> None:
        app = json.loads((ROOT / "mobile-app/app.json").read_text(encoding="utf-8"))["expo"]
        self.assertEqual(app["version"], "2.0.1")
        self.assertEqual(app["android"]["versionCode"], 21)
        config_source = (ROOT / "mobile-app/src/config.ts").read_text(encoding="utf-8")
        self.assertIn("APP_VERSION = '2.0.1'", config_source)

    def test_mobile_version_metadata_stays_aligned(self) -> None:
        package = json.loads((ROOT / "mobile-app/package.json").read_text(encoding="utf-8"))
        lock = json.loads((ROOT / "mobile-app/package-lock.json").read_text(encoding="utf-8"))
        app = json.loads((ROOT / "mobile-app/app.json").read_text(encoding="utf-8"))["expo"]
        self.assertEqual(package["version"], "2.0.1")
        self.assertEqual(lock["version"], package["version"])
        self.assertEqual(lock["packages"][""]["version"], package["version"])
        self.assertEqual(app["version"], package["version"])

    def test_assistant_detail_status_is_declared_before_use(self) -> None:
        source = (ROOT / "backend-nest/src/ia/asistente-context.ts").read_text(encoding="utf-8")
        function_start = source.index("function isAssistantDetailRequest(")
        function_end = source.index("\n}", function_start)
        function_source = source[function_start:function_end]
        declaration = function_source.index("const specificStatus =")
        first_use = function_source.index("specificStatus", declaration + len("const specificStatus ="))
        self.assertLess(declaration, first_use)
        self.assertNotIn("!specificStatus", function_source[:declaration])

    def test_nest_dockerfile_uses_same_peer_dependency_resolution_as_ci(self) -> None:
        source = (ROOT / "backend-nest/Dockerfile").read_text(encoding="utf-8")
        self.assertIn("RUN npm ci --legacy-peer-deps", source)
        self.assertIn("RUN npm ci --omit=dev --legacy-peer-deps", source)


if __name__ == "__main__":
    unittest.main()
