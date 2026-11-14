import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from deploy import IMAGE, check_history, deployment_lock, fingerprint, rollback_target, update_images
from smoke import validate_origin
from setup import create_configuration
from remote import validate_ssh_target


class DeploymentTests(unittest.TestCase):
    def test_pinned_image_contract(self):
        self.assertTrue(IMAGE.fullmatch("ghcr.io/owner/crm:sha-" + "a" * 40))
        self.assertTrue(IMAGE.fullmatch("registry.example.test:5000/owner/crm@sha256:" + "b" * 64))
        for image in ("ghcr.io/owner/crm:latest", "ghcr.io/owner/crm:sha-abc", "image; command"):
            self.assertIsNone(IMAGE.fullmatch(image))

    def test_origin_requires_exact_https(self):
        validate_origin("https://crm.example.test")
        validate_origin("https://localhost:8443")
        for origin in ("http://crm.example.test", "https://crm.example.test/", "https://user:secret@crm.example.test", "https://crm.example.test?token=value", "https://<crm-domain>"):
            with self.assertRaises(RuntimeError):
                validate_origin(origin)

    def test_ssh_target_requires_pinned_host_parameters_and_a_dedicated_directory(self):
        self.assertEqual(validate_ssh_target("vps.example.test", "crm-deploy", "22", "/opt/minimalist-crm/", "a" * 40), "/opt/minimalist-crm")
        for host, user, port, path, sha in (("-oProxyCommand=bad", "deploy", "22", "/opt/crm", "a" * 40),
                                            ("vps.example.test", "deploy", "0", "/opt/crm", "a" * 40),
                                            ("vps.example.test", "deploy", "22", "/opt/.", "a" * 40),
                                            ("vps.example.test", "deploy", "22", "/opt/../etc", "a" * 40),
                                            ("vps.example.test", "deploy", "22", "/opt/crm", "main")):
            with self.assertRaises(RuntimeError):
                validate_ssh_target(host, user, port, path, sha)

    def test_forward_migrations_preserve_history(self):
        old = [{"name": "001", "checksum": "a"}]
        new = old + [{"name": "002", "checksum": "b"}]
        check_history(old, new)
        for manifest in ([], [{"name": "001", "checksum": "changed"}]):
            with self.assertRaises(RuntimeError):
                check_history(old, manifest)
        with self.assertRaises(RuntimeError):
            check_history(new, old)

    def test_rollback_manifest_must_be_an_unchanged_prefix(self):
        old = [{"name": "001", "checksum": "a"}]
        new = old + [{"name": "002", "checksum": "b"}]
        check_history(new, old, rollback=True)
        with self.assertRaises(RuntimeError):
            check_history(old, new, rollback=True)
        with self.assertRaises(RuntimeError):
            check_history(new, [{"name": "001", "checksum": "changed"}], rollback=True)
        with self.assertRaises(RuntimeError):
            check_history(new, [{"name": "002", "checksum": "b"}], rollback=True)

    def test_fingerprint_binds_schema_acknowledgement(self):
        rows = [{"name": "001", "checksum": "a"}]
        self.assertEqual(fingerprint(rows), fingerprint(json.loads(json.dumps(rows))))
        self.assertNotEqual(fingerprint(rows), fingerprint(rows + [{"name": "002", "checksum": "b"}]))
        self.assertEqual(fingerprint([]), hashlib.sha256(b"[]").hexdigest())

    def test_rollback_uses_recorded_registry_digest_and_last_verified_release(self):
        pair = {"image": "ghcr.io/example/crm:sha-" + "a" * 40,
                "migration_image": "ghcr.io/example/crm-migrate:sha-" + "a" * 40,
                "image_digests": ["other.example.test/crm@sha256:" + "b" * 64, "ghcr.io/example/crm@sha256:" + "c" * 64]}
        target = rollback_target({"previous": pair})
        self.assertEqual(target["image"], pair["image_digests"][1])
        self.assertEqual(target["migration_image"], pair["migration_image"])
        self.assertEqual(pair["image"], "ghcr.io/example/crm:sha-" + "a" * 40)
        self.assertEqual(rollback_target({"current": pair, "pending": {"phase": "failed"}}), target)
        self.assertIsNone(rollback_target({"current": pair}))

    def test_environment_update_preserves_credentials_and_other_settings(self):
        with tempfile.TemporaryDirectory(prefix="crm-deploy-unit-") as directory:
            file = Path(directory) / ".env"
            file.write_text("# Keep config\nPOSTGRES_PASSWORD='synthetic-only'\nCRM_IMAGE=old\nOTHER=value\n", encoding="utf-8")
            pair = {"image": "crm:sha-" + "a" * 40, "migration_image": "crm-migrate:sha-" + "a" * 40}
            update_images(file, pair)
            self.assertIn("POSTGRES_PASSWORD='synthetic-only'", file.read_text())
            self.assertIn("OTHER=value", file.read_text())
            self.assertIn("CRM_IMAGE=" + pair["image"], file.read_text())
            self.assertIn("CRM_MIGRATION_IMAGE=" + pair["migration_image"], file.read_text())

    def test_exclusive_release_lock(self):
        with tempfile.TemporaryDirectory(prefix="crm-deploy-lock-") as directory:
            with deployment_lock(Path(directory) / "lock"):
                with self.assertRaises(OSError):
                    with deployment_lock(Path(directory) / "lock"):
                        self.fail("Concurrent deployment acquired the lock")

    def test_first_configuration_creates_private_secrets_without_overwriting(self):
        with tempfile.TemporaryDirectory(prefix="crm-setup-unit-") as directory:
            file = Path(directory) / ".env"
            image = "ghcr.io/example/crm:sha-" + "a" * 40
            migration = "ghcr.io/example/crm-migrate:sha-" + "a" * 40
            create_configuration(file, "crm.example.test", "https://crm.example.test", "synthetic@example.test", image, migration)
            original = file.read_bytes()
            self.assertNotIn(b"POSTGRES_PASSWORD=replace-", original)
            self.assertNotIn(b"SESSION_SECRET=replace-", original)
            self.assertIn(b"CRM_HOST=crm.example.test", original)
            with self.assertRaises(FileExistsError):
                create_configuration(file, "crm.example.test", "https://crm.example.test", "synthetic@example.test", image, migration)
            self.assertEqual(file.read_bytes(), original)

    def test_configuration_rejects_unpinned_images_and_mismatched_origins(self):
        with tempfile.TemporaryDirectory(prefix="crm-setup-unit-") as directory:
            file = Path(directory) / ".env"
            for origin, image in (("https://other.example.test", "ghcr.io/example/crm:sha-" + "a" * 40),
                                  ("https://crm.example.test", "ghcr.io/example/crm:latest")):
                with self.assertRaises(RuntimeError):
                    create_configuration(file, "crm.example.test", origin, "synthetic@example.test", image, image)
            self.assertFalse(file.exists())


if __name__ == "__main__":
    unittest.main()
