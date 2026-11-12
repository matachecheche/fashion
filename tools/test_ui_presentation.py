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

    def test_github_actions_use_node24_compatible_major_versions(self) -> None:
        apk = (ROOT / ".github/workflows/build-apk.yml").read_text(encoding="utf-8")
        self.assertIn("actions/checkout@v7", apk)
        self.assertIn("actions/setup-node@v7", apk)
        self.assertIn("actions/setup-java@v6", apk)
        self.assertIn("actions/cache@v6", apk)
        self.assertIn("actions/upload-artifact@v7", apk)
        for workflow in ("ci.yml", "publish-ghcr.yml"):
            source = (ROOT / ".github/workflows" / workflow).read_text(encoding="utf-8")
            self.assertIn("actions/checkout@v7", source)
            if "setup-node@" in source:
                self.assertIn("actions/setup-node@v7", source)

    def test_pipeline_checks_live_api_health_before_build(self) -> None:
        source = (ROOT / "mobile-app/ci/build-azure-apk.sh").read_text(encoding="utf-8")
        self.assertIn("$API_BASE_URL/health", source)
        self.assertIn("body.estado !== 'ok'", source)
        self.assertLess(source.index("$API_BASE_URL/health"), source.index("npm ci"))


    def test_assistant_ui_does_not_label_welcome_as_local_and_shows_fallback_diagnostic(self) -> None:
        web = (ROOT / "frontend-web/src/components/Asistente.tsx").read_text(encoding="utf-8")
        mobile = (ROOT / "mobile-app/src/screens/Asistente.tsx").read_text(encoding="utf-8")
        self.assertNotIn("proveedor: 'local_rules'", web[:web.index('const enviar')])
        self.assertIn("Diagnóstico técnico:", web)
        self.assertIn("Diagnóstico:", mobile)
        self.assertIn("IA generativa no disponible", web)
        self.assertIn("IA generativa no disponible", mobile)

    def test_mobile_app_version_was_incremented_for_ui_fix(self) -> None:
        app = json.loads((ROOT / "mobile-app/app.json").read_text(encoding="utf-8"))["expo"]
        self.assertEqual(app["version"], "2.3.0")
        self.assertEqual(app["android"]["versionCode"], 27)
        config_source = (ROOT / "mobile-app/src/config.ts").read_text(encoding="utf-8")
        self.assertIn("APP_VERSION = '2.3.0'", config_source)

    def test_mobile_version_metadata_stays_aligned(self) -> None:
        package = json.loads((ROOT / "mobile-app/package.json").read_text(encoding="utf-8"))
        lock = json.loads((ROOT / "mobile-app/package-lock.json").read_text(encoding="utf-8"))
        app = json.loads((ROOT / "mobile-app/app.json").read_text(encoding="utf-8"))["expo"]
        self.assertEqual(package["version"], "2.3.0")
        self.assertEqual(lock["version"], package["version"])
        self.assertEqual(lock["packages"][""]["version"], package["version"])
        self.assertEqual(app["version"], package["version"])


    def test_public_web_proxy_can_be_used_as_the_mobile_api_base(self) -> None:
        nginx = (ROOT / "frontend-web/nginx.azure.conf").read_text(encoding="utf-8")
        deploy = (ROOT / "tools/deploy_azure.py").read_text(encoding="utf-8")
        docs = (ROOT / "docs/APK-AZURE.md").read_text(encoding="utf-8")
        self.assertIn("location /api/", nginx)
        self.assertIn("proxy_pass ${API_UPSTREAM};", nginx)
        self.assertIn("_configure_web_api_upstream(web_payload, api_url)", deploy)
        self.assertIn("fashionstore-web-4edbf7.orangerock-f50972dc.chilecentral.azurecontainerapps.io/api", docs)
        self.assertIn("/api/health", docs)

    def test_android_shell_respects_keyboard_safe_area_and_hardware_back(self) -> None:
        source = (ROOT / "mobile-app/App.tsx").read_text(encoding="utf-8")
        for marker in (
            "useSafeAreaInsets",
            "Keyboard.addListener",
            "KeyboardAvoidingView",
            "keyboardWillShow",
            "keyboardDidShow",
            "hardwareBackPress",
            'accessibilityRole="tab"',
            "sincronizar()",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, source)
        self.assertIn('keyboardShouldPersistTaps="handled"', (ROOT / "mobile-app/src/screens/Auth.tsx").read_text(encoding="utf-8"))

    def test_web_mobile_styles_keep_controls_tappable_and_layouts_responsive(self) -> None:
        source = (ROOT / "frontend-web/src/styles.css").read_text(encoding="utf-8")
        for marker in ("@media (max-width: 640px)", "min-height: 44px", "grid-template-columns: repeat(2, minmax(0, 1fr))", "env(safe-area-inset-bottom)", "overflow-x: auto"):
            with self.subTest(marker=marker):
                self.assertIn(marker, source)

    def test_assistant_detail_status_is_declared_before_use(self) -> None:
        source = (ROOT / "backend-nest/src/ia/asistente-context.ts").read_text(encoding="utf-8")
        function_start = source.index("function isAssistantDetailRequest(")
        function_end = source.index("\n}", function_start)
        function_source = source[function_start:function_end]
        declaration = function_source.index("const specificStatus =")
        first_use = function_source.index("specificStatus", declaration + len("const specificStatus ="))
        self.assertLess(declaration, first_use)
        self.assertNotIn("!specificStatus", function_source[:declaration])

    def test_mobile_assistant_flatlist_has_no_duplicate_keyboard_prop(self) -> None:
        source = (ROOT / "mobile-app/src/screens/Asistente.tsx").read_text(encoding="utf-8")
        self.assertEqual(source.count('keyboardShouldPersistTaps="handled"'), 1)

    def test_ia_status_can_probe_configured_provider_keys(self) -> None:
        source = (ROOT / "backend-nest/src/ia/ia.module.ts").read_text(encoding="utf-8")
        self.assertIn("@Query('probar') probar?: string", source)
        self.assertIn("query: probar === 'true' ? { probar: 'true' } : undefined", source)

    def test_health_exposes_liveness_and_actionable_database_readiness(self) -> None:
        source = (ROOT / "backend-nest/src/app.module.ts").read_text(encoding="utf-8")
        middleware = (ROOT / "backend-nest/src/common/db.ts").read_text(encoding="utf-8")
        self.assertIn("@Get('health/live')", source)
        self.assertIn("DATABASE_HEALTH_CHECK_FAILED", source)
        self.assertIn("ServiceUnavailableException", source)
        self.assertIn("/api/health/live", middleware)
        self.assertIn("DATABASE_URL_REQUIRED", middleware)
        self.assertIn("DATABASE_URL_REQUIRED", (ROOT / "backend-nest/src/common/db.ts").read_text(encoding="utf-8"))

    def test_tenant_resolution_database_errors_are_actionable(self) -> None:
        source = (ROOT / "backend-nest/src/common/db.ts").read_text(encoding="utf-8")
        self.assertIn("error: 'TENANT_RESOLUTION_FAILED'", source)
        self.assertIn("status(503)", source)
        self.assertIn("DATABASE_URL, TLS, permisos de app_runtime", source)

    def test_ghcr_preflights_nest_build_before_publishing_images(self) -> None:
        source = (ROOT / ".github/workflows/publish-ghcr.yml").read_text(encoding="utf-8")
        preflight = source.index("Validate NestJS TypeScript build before publishing")
        first_publish = source.index("Build and publish FastAPI image")
        self.assertLess(preflight, first_publish)
        self.assertIn("npm ci --legacy-peer-deps --no-audit --no-fund", source)
        self.assertIn("npm run build", source)

    def test_nest_dockerfile_uses_same_peer_dependency_resolution_as_ci(self) -> None:
        source = (ROOT / "backend-nest/Dockerfile").read_text(encoding="utf-8")
        self.assertIn("RUN npm ci --legacy-peer-deps", source)
        self.assertIn("RUN npm ci --omit=dev --legacy-peer-deps", source)


if __name__ == "__main__":
    unittest.main()
