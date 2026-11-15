#!/usr/bin/env python3
"""Binary-safe logical backup and restore into a new database only."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from deploy import Deployment, deployment_lock, fingerprint


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def target_database(name, source):
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", name) or name in (source, "postgres", "template0", "template1"):
        raise RuntimeError("Restore requires a different, new database name using lowercase letters, digits and underscores.")
    return name


def verify_archive(path):
    metadata = json.loads(path.with_name(path.name + ".json").read_text(encoding="utf-8"))
    if metadata.get("format") != "postgresql-custom" or metadata.get("sha256") != sha256_file(path):
        raise RuntimeError("Backup checksum or format validation failed; do not restore this archive.")
    if metadata.get("session_rows_included") is not False:
        raise RuntimeError("This procedure requires a backup that excludes live session rows.")
    return metadata


def stream_command(deployment, arguments, *, source=None, destination=None):
    result = subprocess.run(deployment.command + arguments, stdin=source, stdout=destination or subprocess.DEVNULL,
                            stderr=subprocess.PIPE, env=deployment.environment, check=False, timeout=1800)
    if result.returncode:
        raise RuntimeError("PostgreSQL backup/restore command failed; private archive contents and raw diagnostics are withheld.")


def backup(deployment, output):
    pg = deployment.services["postgres"]["environment"]
    output = output.resolve()
    metadata_file = output.with_name(output.name + ".json")
    if output.exists() or metadata_file.exists():
        raise RuntimeError("Backup paths already exist; existing backups are never overwritten.")
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with deployment_lock(deployment.env_file.parent / ".deployment.lock"):
        schema = fingerprint(deployment.history())
        descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream_command(deployment, ["exec", "-T", "postgres", "pg_dump", "-U", pg["POSTGRES_USER"],
                               "--dbname", pg["POSTGRES_DB"], "--format=custom", "--no-owner", "--no-acl",
                               "--exclude-table-data=public.session"], destination=stream)
        except Exception:
            output.unlink(missing_ok=True)  # Only the exclusively created output file.
            raise
        metadata = {"format": "postgresql-custom", "created_at": datetime.now(timezone.utc).isoformat(),
                    "sha256": sha256_file(output), "schema_fingerprint": schema, "session_rows_included": False,
                    "source_image": deployment.pair()["image"]}
        descriptor = os.open(metadata_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(metadata, stream, indent=2)
        # Verify archive TOC readability without emitting SQL or table contents.
        with output.open("rb") as stream:
            stream_command(deployment, ["exec", "-T", "postgres", "pg_restore", "--list"], source=stream)
    print(json.dumps({"status": "backup_created", "bytes": output.stat().st_size, "sha256": metadata["sha256"]}))


def restore(deployment, archive, database, confirmation):
    pg = deployment.services["postgres"]["environment"]
    database = target_database(database, pg["POSTGRES_DB"])
    if confirmation != database:
        raise RuntimeError("Confirm the new restore target with --confirm-new-database and the same name.")
    metadata = verify_archive(archive)
    with deployment_lock(deployment.env_file.parent / ".deployment.lock"):
        # createdb fails on an existing target. No --clean, DROP, or replacement path exists.
        deployment.compose("exec", "-T", "postgres", "createdb", "-U", pg["POSTGRES_USER"],
                           "--maintenance-db", pg["POSTGRES_DB"], "--template", "template0", database)
        with archive.open("rb") as stream:
            stream_command(deployment, ["exec", "-T", "postgres", "pg_restore", "-U", pg["POSTGRES_USER"],
                           "--dbname", database, "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction"], source=stream)
        if fingerprint(deployment.history(database)) != metadata["schema_fingerprint"]:
            raise RuntimeError("Restored migration history differs from the backup metadata; keep the target isolated.")
        query = ('SELECT json_build_object(\'contacts\',(SELECT count(*) FROM "Contact"),'
                 '\'leads\',(SELECT count(*) FROM "Lead"),\'opportunities\',(SELECT count(*) FROM "Opportunity"),'
                 '\'users\',(SELECT count(*) FROM "User"),\'sessions\',(SELECT count(*) FROM "session"))')
        counts = json.loads(deployment.compose("exec", "-T", "postgres", "psql", "-U", pg["POSTGRES_USER"], "-d", database, "-Atc", query))
        if counts["sessions"] != 0:
            raise RuntimeError("Restored session rows must be empty.")
    print(json.dumps({"status": "restore_verified", "counts": counts, "schema_fingerprint": metadata["schema_fingerprint"]}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("backup", "restore"))
    parser.add_argument("--env-file", default=str(Path(__file__).resolve().parent / ".env"))
    parser.add_argument("--output", help="New private archive file; existing files are never overwritten")
    parser.add_argument("--input")
    parser.add_argument("--database")
    parser.add_argument("--confirm-new-database")
    args = parser.parse_args()
    # Reuse the same validated private deployment configuration; no secret values are logged.
    args.expected_origin = None
    try:
        deployment = Deployment(args)
        if args.command == "backup":
            name = datetime.now(timezone.utc).strftime("crm-%Y%m%dT%H%M%SZ.dump")
            backup(deployment, Path(args.output) if args.output else deployment.env_file.parent / "backups" / name)
        else:
            if not args.input or not args.database:
                raise RuntimeError("Restore requires --input, --database, and --confirm-new-database.")
            restore(deployment, Path(args.input).resolve(), args.database, args.confirm_new_database)
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else "Backup/restore failed; inspect private server configuration and the isolated restore target.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
