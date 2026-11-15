#!/usr/bin/env python3
"""Create a new private VPS configuration without displaying generated secrets."""
import argparse
import os
from pathlib import Path
import re
import secrets
import sys

from deploy import IMAGE, atomic_write
from smoke import validate_origin


def create_configuration(path, host, origin, email, image, migration_image):
    validate_origin(origin)
    from urllib.parse import urlsplit
    if (not re.fullmatch(r"[a-z0-9][a-z0-9.-]*", host) or urlsplit(origin).hostname != host or
            not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or not IMAGE.fullmatch(image) or not IMAGE.fullmatch(migration_image)):
        raise RuntimeError("Use a matching lowercase hostname/HTTPS origin, certificate email, and complete SHA-tagged image references.")
    content = (Path(__file__).resolve().parent / ".env.example").read_text(encoding="utf-8")
    settings = {"CRM_HOST": host, "CRM_ORIGIN": origin, "ACME_EMAIL": email, "CRM_IMAGE": image,
                "CRM_MIGRATION_IMAGE": migration_image, "POSTGRES_PASSWORD": secrets.token_urlsafe(32),
                "SESSION_SECRET": secrets.token_hex(48), "GRAFANA_ADMIN_PASSWORD": secrets.token_hex(24)}
    for key, value in settings.items():
        content = re.sub(rf"^{key}=.*$", lambda _match: f"{key}={value}", content, flags=re.MULTILINE)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def configure_monitoring(path):
    content = path.read_text(encoding="utf-8")
    current = re.search(r"^GRAFANA_ADMIN_PASSWORD=(.*)$", content, re.MULTILINE)
    value = current.group(1).strip().strip("\"'") if current else ""
    if value and not value.startswith("replace-"):
        if len(value) < 12:
            raise RuntimeError("Existing Grafana password is too short; rotate the initialized account and update private configuration with at least 12 characters.")
        return False  # Never silently rotate credentials of an existing Grafana volume.
    setting = "GRAFANA_ADMIN_PASSWORD=" + secrets.token_hex(24)
    if current:
        content = re.sub(r"^GRAFANA_ADMIN_PASSWORD=.*$", lambda _match: setting, content, flags=re.MULTILINE)
    else:
        content += "\n" + setting + "\n"
    atomic_write(path, content)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", default=str(Path(__file__).resolve().parent / ".env"))
    parser.add_argument("--monitoring", action="store_true", help="Add a missing private Grafana password to an existing configuration")
    args = parser.parse_args()
    try:
        path = Path(args.env_file).resolve()
        if args.monitoring:
            configure_monitoring(path)
            print("Private monitoring credentials configured; existing valid secrets preserved. No secret values displayed.")
            return 0
        if path.exists():
            raise RuntimeError("Configuration already exists; existing database passwords and session secrets are preserved. Edit public settings deliberately.")
        host = input("CRM hostname (lowercase, without https://): ").strip()
        origin = input(f"Exact HTTPS origin [https://{host}]: ").strip() or f"https://{host}"
        email = input("Certificate contact email: ").strip()
        image = input("Published runtime image reference: ").strip()
        migration = input("Matching migration image reference: ").strip()
        create_configuration(path, host, origin, email, image, migration)
        print("Created the private server environment file with random database and session secrets. No secret values were displayed.")
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else "Configuration was not created. Check inputs and file permissions; existing files are never replaced.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
