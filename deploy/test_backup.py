import json
from pathlib import Path
import tempfile
import unittest

from backup import sha256_file, target_database, verify_archive
from setup import configure_monitoring


class OperationsTests(unittest.TestCase):
    def test_restore_cannot_target_source_or_system_database(self):
        self.assertEqual(target_database("crm_restore_check", "crm"), "crm_restore_check")
        for name in ("crm", "postgres", "template0", "template1", "../crm", "crm;DROP", "", "a" * 64):
            with self.assertRaises(RuntimeError):
                target_database(name, "crm")

    def test_archive_integrity_and_session_policy_are_required(self):
        with tempfile.TemporaryDirectory(prefix="crm-backup-unit-") as directory:
            archive = Path(directory) / "synthetic.dump"
            archive.write_bytes(b"synthetic-only archive fixture")
            metadata = {"format": "postgresql-custom", "sha256": sha256_file(archive), "session_rows_included": False}
            sidecar = archive.with_name(archive.name + ".json")
            sidecar.write_text(json.dumps(metadata), encoding="utf-8")
            self.assertEqual(verify_archive(archive), metadata)
            archive.write_bytes(b"tampered")
            with self.assertRaises(RuntimeError):
                verify_archive(archive)
            metadata["sha256"] = sha256_file(archive)
            metadata["session_rows_included"] = True
            sidecar.write_text(json.dumps(metadata), encoding="utf-8")
            with self.assertRaises(RuntimeError):
                verify_archive(archive)

    def test_monitoring_setup_preserves_existing_secrets_and_is_repeatable(self):
        with tempfile.TemporaryDirectory(prefix="crm-monitoring-unit-") as directory:
            file = Path(directory) / ".env"
            original = "POSTGRES_PASSWORD='synthetic-only'\nSESSION_SECRET=synthetic-session\n"
            file.write_text(original, encoding="utf-8")
            self.assertTrue(configure_monitoring(file))
            first = file.read_text(encoding="utf-8")
            self.assertTrue(first.startswith(original))
            self.assertIn("GRAFANA_ADMIN_PASSWORD=", first)
            self.assertFalse(configure_monitoring(file))
            self.assertEqual(file.read_text(encoding="utf-8"), first)
            file.write_text(original + "GRAFANA_ADMIN_PASSWORD=short\n", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                configure_monitoring(file)
            self.assertTrue(file.read_text(encoding="utf-8").endswith("GRAFANA_ADMIN_PASSWORD=short\n"))
