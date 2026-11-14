#!/usr/bin/env python3
"""Create a new private VPS configuration without displaying generated secrets."""
import argparse
import os
from pathlib import Path
import re
import secrets
import sys

from deploy import IMAGE
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
                "SESSION_SECRET": secrets.token_hex(48)}
    for key, value in settings.items():
        content = re.sub(rf"^{key}=.*$", lambda _match: f"{key}={value}", content, flags=re.MULTILINE)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", default=str(Path(__file__).resolve().parent / ".env"))
    args = parser.parse_args()
    try:
        path = Path(args.env_file).resolve()
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
