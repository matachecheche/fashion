"""Unit tests for the safe FashionStore package filters and verifier."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from iniciar import ensure_nest_dependencies, ensure_postgres, main, mode_docker, nest_dependencies_ready, nest_env  # noqa: E402
from tools import paquetizar_proyecto as pack  # noqa: E402
from tools import verificar_manifiesto as verify  # noqa: E402


class PackageFilterTests(unittest.TestCase):
    def test_secrets_and_builds_are_excluded_but_example_is_kept(self) -> None:
        for rel in (
            ".env",
            ".env.production",
            "nested/credentials.json",
            "id_ed25519",
            "server.pem",
            "signing.keystore",
            "local.db",
            "node_modules/pkg/index.js",
            "docs/screenshots/login.png",
        ):
            with self.subTest(path=rel):
                self.assertTrue(pack.excluded(Path(rel)))
        self.assertFalse(pack.excluded(Path(".env.example")))
        self.assertFalse(pack.excluded(Path("README.md")))

    def test_cache_build_and_sensitive_directories_are_pruned(self) -> None:
        for rel in (
            "node_modules",
            ".cache",
            ".venv-ia",
            "docs/screenshots",
            ".aws",
        ):
            with self.subTest(path=rel):
                self.assertTrue(pack.excluded_directory(Path(rel)))

    def test_zip_verifier_rejects_paths_secrets_and_large_artifact_folders(self) -> None:
        rejected = (
            "fashionstore/../escape.txt",
            "fashionstore/.env",
            "fashionstore/docs/screenshots/a.png",
            "fashionstore/node_modules/pkg/a.js",
            "fashionstore/private.key",
        )
        for name in rejected:
            with self.subTest(path=name):
                self.assertTrue(verify.forbidden_zip_entries([name]))
        self.assertFalse(verify.forbidden_zip_entries(["fashionstore/.env.example"]))
        self.assertFalse(verify.forbidden_zip_entries(["fashionstore/README.md"]))

    def test_secret_scanner_detects_common_markers_without_echoing_values(self) -> None:
        # Build synthetic patterns in pieces so this regression fixture itself never
        # contains a complete credential-shaped token.
        fake_aws = ("AK" + "IA" + "1234567890ABCDEF").encode()
        fake_private_key = b"-----BEGIN " + b"RSA PRIVATE KEY-----"
        fake_db_url = b"postgresql://admin:" + b"fixture-value-812738492@db.invalid/app"
        for data in (fake_aws, fake_private_key, fake_db_url):
            with self.subTest(kind=len(data)):
                self.assertTrue(verify.secret_markers(data, "fixture.txt"))

    def test_placeholders_and_runtime_interpolation_are_not_misclassified(self) -> None:
        fixtures = (
            b"JWT_SECRET=REPLACE_WITH_RANDOM_64_HEX_CHARACTERS",
            b"DATABASE_URL=postgresql://USER:REPLACE_ME@127.0.0.1:5432/app",
            b"postgresql://postgres:{runtime_password}@127.0.0.1:5432/app",
            b"STRIPE_WEBHOOK_SECRET=whsec_REPLACE_FROM_TEST_DASHBOARD",
            b"STRIPE_SECRET_KEY=rk_test_REPLACE_FROM_STRIPE_TEST_DASHBOARD",
            b"STRIPE_SIMULATOR_WEBHOOK_SECRET=REPLACE_WITH_RANDOM_LOCAL_SIMULATOR_SECRET",
        )
        for data in fixtures:
            with self.subTest(kind=len(data)):
                self.assertEqual(verify.secret_markers(data, "fixture.env.example"), [])


class StartupDependencyChecks(unittest.TestCase):
    def test_native_simulator_secret_is_separate_from_stripe_webhook_secret(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            nest_dir = root / "backend-nest"
            nest_dir.mkdir()
            stripe_secret = "whsec_" + "fixture" * 2
            (nest_dir / ".env").write_text(
                f"STRIPE_WEBHOOK_SECRET={stripe_secret}\n"
                "STRIPE_SIMULATOR_WEBHOOK_SECRET=REPLACE_WITH_RANDOM_LOCAL_SIMULATOR_SECRET\n",
                encoding="utf-8",
            )
            with patch("iniciar.ROOT", root):
                env = nest_env()

        self.assertEqual(env["STRIPE_WEBHOOK_SECRET"], stripe_secret)
        self.assertNotEqual(env["STRIPE_SIMULATOR_WEBHOOK_SECRET"], stripe_secret)
        self.assertGreaterEqual(len(env["STRIPE_SIMULATOR_WEBHOOK_SECRET"]), 64)

    def test_legacy_keep_db_flag_cannot_bypass_factory_reset(self) -> None:
        with (
            patch("iniciar.sys.argv", ["iniciar.py", "--keep-db"]),
            patch("iniciar.fail", side_effect=SystemExit(2)) as failure,
            patch("iniciar.mode_docker") as docker_mode,
            patch("iniciar.mode_native") as native_mode,
        ):
            with self.assertRaises(SystemExit) as error:
                main()
            self.assertEqual(error.exception.code, 2)
            self.assertIn("--keep-db fue retirado", failure.call_args.args[0])
            docker_mode.assert_not_called()
            native_mode.assert_not_called()

    def test_docker_start_prepares_env_then_resets_volume_and_uses_env_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            commands: list[list[str]] = []
            with (
                patch("iniciar.ROOT", root),
                patch("iniciar.fail_if_ports_busy"),
                patch("iniciar.have", return_value=True),
                patch("iniciar.run", side_effect=lambda cmd, **_kwargs: commands.append(list(cmd))),
                patch("iniciar.wait_for"),
                patch("iniciar.print_banner"),
                patch("iniciar.log"),
            ):
                self.assertEqual(mode_docker(), 0)

        self.assertEqual(commands[0][-1], str(root / "tools" / "preparar_docker_env.py"))
        compose_commands = [cmd for cmd in commands[1:] if cmd[:2] == ["docker", "compose"]]
        self.assertEqual(len(compose_commands), 3)
        for cmd in compose_commands:
            self.assertEqual(cmd[2:4], ["--env-file", "builds/.env.docker"])
        self.assertIn(["down", "-v"], [cmd[-2:] for cmd in compose_commands])
        self.assertIn(["up", "--build", "-d"], [cmd[-3:] for cmd in compose_commands])

    def test_docker_batch_delegates_to_factory_orchestrator(self) -> None:
        bat = (ROOT / "iniciar-docker.bat").read_text(encoding="utf-8").lower()
        self.assertIn("iniciar.py --docker", bat)
        self.assertNotIn("docker compose --env-file", bat)

    def test_native_start_always_recreates_utf8_factory_database(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "database" / "migrations").mkdir(parents=True)
            commands: list[tuple[str, str]] = []

            def fake_psql(sql: str, db: str = "fashionstore", user: str = "postgres"):
                commands.append((sql, db))
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            with (
                patch("iniciar.ROOT", root),
                patch("iniciar.port_open", return_value=True),
                patch("iniciar.ensure_pg_password"),
                patch("iniciar.psql", side_effect=fake_psql),
                patch("iniciar.sql_file") as apply_sql,
                patch("iniciar.secrets.token_urlsafe", return_value="test-only-password"),
                patch("iniciar.log"),
            ):
                ensure_postgres()

            sql = [statement for statement, _ in commands]
            self.assertIn("DROP DATABASE IF EXISTS fashionstore WITH (FORCE);", sql)
            self.assertIn(
                "CREATE DATABASE fashionstore WITH ENCODING 'UTF8' TEMPLATE template0;",
                sql,
            )
            self.assertFalse(any("information_schema" in statement or "meta" in statement for statement in sql))
            apply_sql.assert_any_call(root / "database" / "schema.sql")
            apply_sql.assert_any_call(root / "database" / "seed.sql")
            self.assertTrue((root / "builds" / ".fs_app_password").is_file())

    def test_existing_nest_modules_without_resolvable_express_trigger_reinstall(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            nest_dir = Path(temp_dir)
            modules = nest_dir / "node_modules"
            modules.mkdir()
            for rel in (
                "@nestjs/core/package.json",
                "@nestjs/platform-express/package.json",
                "@nestjs/serve-static/package.json",
            ):
                path = modules / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("{}", encoding="utf-8")

            # Exact reported state: node_modules and Nest exist, but Express does not.
            with patch("iniciar.run") as npm_install, patch("iniciar.log"):
                ensure_nest_dependencies(nest_dir)
                npm_install.assert_called_once_with(
                    ["npm", "install", "--legacy-peer-deps"], cwd=nest_dir
                )

            # A stale/broken Express directory must also be repaired if Node cannot resolve it.
            express = modules / "express" / "package.json"
            express.parent.mkdir(parents=True, exist_ok=True)
            express.write_text('{"version":"5.3.0"}', encoding="utf-8")
            with patch("iniciar.subprocess.run") as node_check, patch("iniciar.run") as npm_install, patch("iniciar.log"):
                node_check.return_value.returncode = 1
                ensure_nest_dependencies(nest_dir)
                self.assertEqual(node_check.call_args.kwargs["cwd"], nest_dir)
                self.assertIn("express", node_check.call_args.args[0])
                npm_install.assert_called_once_with(
                    ["npm", "install", "--legacy-peer-deps"], cwd=nest_dir
                )

                # A successful Node module resolution should skip the repair install.
                node_check.return_value.returncode = 0
                ensure_nest_dependencies(nest_dir)
                npm_install.assert_called_once()


if __name__ == "__main__":
    unittest.main()
