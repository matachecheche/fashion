"""Static and shell-contract tests for the Azure standalone APK build."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIPELINE = ROOT / "azure-pipelines-apk.yml"
BUILD_SCRIPT = ROOT / "mobile-app/ci/build-azure-apk.sh"
DOC = ROOT / "docs/APK-AZURE.md"
APP_CONFIG = ROOT / "mobile-app/app.json"


def find_usable_bash() -> str | None:
    r"""Find a real GNU Bash, not the Windows WSL launcher without a distro.

    The APK build script runs on Azure's Ubuntu agent. On Windows, Bash is
    optional; `C:\Windows\System32\bash.exe` may only be the WSL shim and
    returns an error when no Linux distribution is installed. In that case
    the local syntax check is skipped, while Azure Ubuntu still runs it.
    """
    candidates: list[str] = []
    discovered = shutil.which("bash")
    if discovered:
        candidates.append(discovered)

    if os.name == "nt":
        program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
        program_files_x86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        for base in (program_files, program_files_x86, local_app_data):
            if base:
                candidates.extend([
                    str(Path(base) / "Git" / "bin" / "bash.exe"),
                    str(Path(base) / "Git" / "usr" / "bin" / "bash.exe"),
                ])

    seen: set[str] = set()
    for candidate in candidates:
        key = os.path.normcase(os.path.abspath(candidate))
        if key in seen:
            continue
        seen.add(key)
        try:
            # A WSL launcher can sometimes answer `--version` without proving
            # that a Linux distribution is available. Execute a tiny shell
            # command as well; Git Bash and real GNU Bash both pass this probe.
            marker = "FASHIONSTORE_GNU_BASH_PROBE_OK"
            functional = subprocess.run(
                [candidate, "-c", f"printf '%s' {marker}"],
                capture_output=True, text=True, timeout=8, check=False,
            )
            version = subprocess.run(
                [candidate, "--version"], capture_output=True, text=True,
                timeout=8, check=False,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        output = (version.stdout or "") + (version.stderr or "")
        if (
            functional.returncode == 0
            and marker in (functional.stdout or "")
            and version.returncode == 0
            and "GNU bash" in output
        ):
            return candidate
    return None


class AzureStandaloneApkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pipeline = PIPELINE.read_text(encoding="utf-8")
        cls.script = BUILD_SCRIPT.read_text(encoding="utf-8")
        cls.doc = DOC.read_text(encoding="utf-8")

    def test_shell_script_has_valid_bash_syntax(self) -> None:
        bash = find_usable_bash()
        if not bash:
            self.skipTest(
                "Bash GNU no está instalado o el comando disponible es solo el "
                "lanzador WSL sin una distribución Linux. Esta comprobación se "
                "ejecuta en el agente Ubuntu de Azure Pipelines; instale Git Bash "
                "para ejecutarla también localmente en Windows."
            )
        result = subprocess.run(
            [bash, "-n", str(BUILD_SCRIPT)], capture_output=True, text=True, timeout=15
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

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
