#!/usr/bin/env python3
"""Opt-in GitHub environment deployment using pinned SSH host keys."""
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess
import sys
import tempfile

from smoke import validate_origin, verify


def validate_ssh_target(host, user, port, path, sha):
    normalized = str(PurePosixPath(path))
    if (not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]*", host) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", user)
            or not re.fullmatch(r"/[A-Za-z0-9_./-]+", path) or len(PurePosixPath(normalized).parts) < 3
            or ".." in path.split("/") or not port.isdigit() or not 1 <= int(port) <= 65535
            or not re.fullmatch(r"[0-9a-f]{40}", sha)):
        raise RuntimeError("Invalid SSH host, user, port, dedicated deployment path, or full commit SHA.")
    return normalized


def main():
    required = ("VPS_HOST", "VPS_USER", "VPS_PATH", "VPS_SSH_PRIVATE_KEY", "VPS_KNOWN_HOSTS", "RELEASE_SHA", "CRM_ORIGIN")
    if any(not os.getenv(name) for name in required):
        raise RuntimeError("Configure the selected GitHub environment's VPS variables, SSH secrets, and CRM_ORIGIN first.")
    host, user, path = (os.environ[name] for name in ("VPS_HOST", "VPS_USER", "VPS_PATH"))
    port = os.getenv("VPS_PORT") or "22"
    sha = os.environ["RELEASE_SHA"]
    path = validate_ssh_target(host, user, port, path, sha)
    origin = os.environ["CRM_ORIGIN"]
    validate_origin(origin)
    stage = os.getenv("DEPLOY_ENVIRONMENT") == "staging"
    if stage and (not os.getenv("CRM_SMOKE_USERNAME") or not os.getenv("CRM_SMOKE_PASSWORD")):
        raise RuntimeError("Staging requires an already-provisioned authorized smoke-test account.")
    default_repository = "ghcr.io/" + os.environ["GITHUB_REPOSITORY"].lower()
    repository = os.getenv("IMAGE_REPOSITORY") or default_repository + "-app"
    migration_repository = os.getenv("MIGRATION_IMAGE_REPOSITORY") or (repository + "-migrate" if os.getenv("IMAGE_REPOSITORY") else default_repository + "-migrate")
    if any(not re.fullmatch(r"[a-z0-9][a-z0-9._:/-]+", value) for value in (repository, migration_repository)):
        raise RuntimeError("Invalid configurable image repository.")
    image, migration = f"{repository}:sha-{sha}", f"{migration_repository}:sha-{sha}"
    registry = os.getenv("REGISTRY_HOST") or repository.split("/")[0]
    registry_user, token = os.getenv("REGISTRY_USERNAME"), os.getenv("REGISTRY_READ_TOKEN")
    if token and (not registry_user or not re.fullmatch(r"[A-Za-z0-9._-]+", registry_user) or not re.fullmatch(r"[A-Za-z0-9.:-]+", registry)):
        raise RuntimeError("Configure a registry host and read-only account for registry authentication.")
    with tempfile.TemporaryDirectory(prefix="crm-ssh-") as directory:
        key = Path(directory) / "identity"
        hosts = Path(directory) / "known_hosts"
        for file, setting in ((key, "VPS_SSH_PRIVATE_KEY"), (hosts, "VPS_KNOWN_HOSTS")):
            file.write_text(os.environ[setting].rstrip() + "\n", encoding="utf-8")
            file.chmod(0o600)
        options = ["-i", str(key), "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={hosts}"]
        destination = f"{user}@{host}"

        def ssh(arguments, secret=None):
            # Only public configuration enters the remote command; tokens travel through stdin.
            subprocess.run(["ssh", *options, "-p", port, destination, shlex.join(arguments)], input=secret,
                           text=True, check=True, timeout=1200)

        ssh(["mkdir", "-p", "--", path])
        ssh(["chmod", "700", "--", path])
        source = Path(__file__).resolve().parent
        files = [str(source / name) for name in ("compose.yaml", "Caddyfile", ".env.example", "deploy.py", "smoke.py", "setup.py")]
        subprocess.run(["scp", *options, "-P", port, *files, destination + ":" + path + "/"], check=True, timeout=60)
        if token:
            ssh(["docker", "login", registry, "--username", registry_user, "--password-stdin"], token)
        ssh(["python3", path + "/deploy.py", "deploy", "--env-file", path + "/.env", "--image", image,
             "--migration-image", migration, "--expected-origin", origin])
        verify(origin, username=os.getenv("CRM_SMOKE_USERNAME"), password=os.getenv("CRM_SMOKE_PASSWORD"), allow_write=stage)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Remote deployment failed. Check the selected environment's settings, pinned SSH host key, server configuration, registry access, and authorized test account. Secret values are withheld.", file=sys.stderr)
        sys.exit(1)
