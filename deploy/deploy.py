#!/usr/bin/env python3
"""Deploy immutable image pairs; never reset/seed a database or auto-revert it."""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import traceback

from smoke import check_ready, validate_origin

ROOT = Path(__file__).resolve().parent
REVISION = re.compile(r"[0-9a-f]{40}\Z")
IMAGE = re.compile(r"[a-z0-9][a-z0-9._/:-]*(?::sha-[0-9a-f]{40}|@sha256:[0-9a-f]{64})\Z")


def atomic_write(path, content):
    temporary = path.with_name(path.name + ".tmp")
    with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
        os.chmod(temporary, 0o600)
        handle.write(content)
    os.replace(temporary, path)


@contextlib.contextmanager
def deployment_lock(path):
    with open(path, "a+b") as handle:
        os.chmod(path, 0o600)
        handle.seek(0)
        if os.name == "nt":
            import msvcrt
            handle.write(b"0")
            handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def fingerprint(rows):
    encoded = json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def check_history(applied, manifest, rollback=False):
    prefix, complete = (manifest, applied) if rollback else (applied, manifest)
    if complete[:len(prefix)] != prefix:
        raise RuntimeError("Target migration history is missing or changes applied SQL; stop for schema review.")


def rollback_target(state):
    recorded = state.get("current") if state.get("pending") else state.get("previous")
    if not recorded:
        return None
    target = dict(recorded)
    for key in ("image", "migration_image"):
        repository = re.sub(r":sha-[0-9a-f]{40}$", "", recorded[key].split("@")[0])
        digests = recorded.get(key + "_digests") or []
        target[key] = next((digest for digest in digests if digest.startswith(repository + "@sha256:")), recorded[key])
    return target


class Deployment:
    def __init__(self, args, target=None):
        self.args = args
        self.env_file = Path(args.env_file).resolve()
        if not self.env_file.is_file():
            raise RuntimeError("Create the server environment file from deploy/.env.example first.")
        self.environment = os.environ.copy()
        # Only image selection is overridden. Secrets remain in the server file.
        if target:
            self.environment.update(CRM_IMAGE=target["image"], CRM_MIGRATION_IMAGE=target["migration_image"])
        self.command = ["docker", "compose", "--profile", "tools", "--env-file", str(self.env_file), "-f", str(ROOT / "compose.yaml")]
        self.config = json.loads(self.compose("config", "--format", "json"))
        self.services = self.config["services"]
        self.origin = self.services["app"]["environment"]["APP_ORIGIN"]
        validate_origin(self.origin)
        self.validate_config()

    def run(self, arguments, input_data=None, timeout=300):
        result = subprocess.run(arguments, input=input_data, text=True, encoding="utf-8", errors="replace",
                                capture_output=True, env=self.environment, timeout=timeout, check=False)
        if result.returncode:
            # Docker config and Prisma diagnostics can contain server material; don't dump them.
            operations = {"config", "pull", "run", "up", "exec", "app", "migrate", "proxy", "postgres", "inspect"}
            operation = " ".join(value for value in arguments[1:] if value in operations)
            codes = sorted(set(re.findall(r"\bP[0-9]{4}\b", result.stdout + result.stderr)))
            detail = ", ".join(codes) or "no public error code"
            raise RuntimeError(f"Container command failed ({operation}; exit {result.returncode}; {detail}); inspect that service on the server without dumping environment values.")
        return result.stdout

    def compose(self, *arguments, **options):
        return self.run(self.command + list(arguments), **options)

    def validate_config(self):
        app = self.services["app"]["environment"]
        proxy = self.services["proxy"]["environment"]
        from urllib.parse import urlsplit
        if urlsplit(self.origin).hostname != proxy["CRM_HOST"]:
            raise RuntimeError("CRM_HOST and CRM_ORIGIN must identify the same host.")
        if self.args.expected_origin and self.args.expected_origin != self.origin:
            raise RuntimeError("Server origin differs from the intended deployment environment.")
        if app["NODE_ENV"] != "production" or str(app["TRUST_PROXY_HOPS"]) != "1":
            raise RuntimeError("Production mode and exactly one private trusted proxy are required.")
        if len(app["SESSION_SECRET"]) < 32 or app["SESSION_SECRET"].startswith("replace-"):
            raise RuntimeError("Configure a random SESSION_SECRET of at least 32 characters.")
        if len(app["POSTGRES_PASSWORD"]) < 16 or app["POSTGRES_PASSWORD"].startswith("replace-"):
            raise RuntimeError("Configure a random PostgreSQL password of at least 16 characters.")
        if (proxy["CRM_HOST"] == "example.com" or proxy["CRM_HOST"].endswith(".example.com") or proxy["ACME_EMAIL"].startswith("replace-")):
            raise RuntimeError("Replace the hostname and certificate email placeholders.")
        for name in ("app", "postgres", "migrate"):
            if self.services[name].get("ports"):
                raise RuntimeError("Only the HTTPS reverse proxy may publish host ports.")
            if "edge" in self.services[name].get("networks", {}):
                raise RuntimeError("Application/database services must remain on private networks.")
        if not all(self.config["networks"][name].get("internal") for name in ("frontend", "database")):
            raise RuntimeError("Frontend and database networks must be internal.")
        for key in ("CRM_IMAGE", "CRM_MIGRATION_IMAGE"):
            value = self.environment.get(key) or self.services["app" if key == "CRM_IMAGE" else "migrate"]["image"]
            if not IMAGE.fullmatch(value):
                raise RuntimeError("Use full commit-SHA image tags or immutable registry digests.")

    def pair(self):
        return {"image": self.services["app"]["image"], "migration_image": self.services["migrate"]["image"]}

    def inspect_pair(self):
        pair = self.pair()
        revisions = []
        for key in ("image", "migration_image"):
            data = json.loads(self.run(["docker", "image", "inspect", pair[key]]))[0]
            revision = (data.get("Config", {}).get("Labels") or {}).get("org.opencontainers.image.revision", "")
            if not REVISION.fullmatch(revision):
                raise RuntimeError("Images must carry the full source commit revision label.")
            if ":sha-" in pair[key] and pair[key].rsplit(":sha-", 1)[1] != revision:
                raise RuntimeError("Image tag and source revision label do not agree.")
            revisions.append(revision)
            pair[key + "_id"] = data["Id"]
            pair[key + "_digests"] = data.get("RepoDigests") or []
        if revisions[0] != revisions[1]:
            raise RuntimeError("Runtime and migration images must come from the same commit.")
        pair["revision"] = revisions[0]
        return pair

    def manifest(self):
        code = ("import{readdirSync,readFileSync}from'node:fs';import{createHash}from'node:crypto';"
                "const p='/app/backend/prisma/migrations';console.log(JSON.stringify(readdirSync(p,{withFileTypes:true})"
                ".filter(e=>e.isDirectory()).map(e=>({name:e.name,checksum:createHash('sha256')"
                ".update(readFileSync(p+'/'+e.name+'/migration.sql')).digest('hex')})).sort((a,b)=>a.name.localeCompare(b.name))));")
        return json.loads(self.run(["docker", "run", "--rm", "--network", "none", "--entrypoint", "node",
                                   self.pair()["migration_image"], "--input-type=module", "-e", code]))

    def history(self):
        pg = self.services["postgres"]["environment"]
        command = ["exec", "-T", "postgres", "psql", "-U", pg["POSTGRES_USER"], "-d", pg["POSTGRES_DB"], "-Atc"]
        exists = self.compose(*command, "SELECT to_regclass('public._prisma_migrations') IS NOT NULL").strip()
        if exists != "t":
            return []
        rows = json.loads(self.compose(*command, 'SELECT COALESCE(json_agg(row_to_json(m)), \'[]\'::json) FROM '
                                      '(SELECT migration_name AS name, checksum, finished_at IS NOT NULL AS finished, '
                                      'rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations" ORDER BY migration_name) m'))
        if any(not row["finished"] and not row["rolled_back"] for row in rows):
            raise RuntimeError("An unfinished migration requires manual resolution before deployment or rollback.")
        return [{"name": row["name"], "checksum": row["checksum"]} for row in rows if row["finished"] and not row["rolled_back"]]


def update_images(path, pair):
    content = path.read_text(encoding="utf-8")
    for key, value in (("CRM_IMAGE", pair["image"]), ("CRM_MIGRATION_IMAGE", pair["migration_image"])):
        pattern = rf"^{key}=.*$"
        if re.search(pattern, content, re.MULTILINE):
            content = re.sub(pattern, lambda _match: key + "=" + value, content, flags=re.MULTILINE)
        else:
            content += f"\n{key}={value}\n"
    atomic_write(path, content)


def execute(args):
    env_file = Path(args.env_file).resolve()
    state_file = env_file.parent / ".deployment-state.json"
    if args.command != "deploy" and (args.image or args.migration_image):
        raise RuntimeError("Image overrides are supported only for a forward deployment.")
    state = json.loads(state_file.read_text(encoding="utf-8")) if state_file.exists() else {}
    if args.command == "rollback":
        target = rollback_target(state)
        if not target:
            raise RuntimeError("No recorded previous verified image pair is available.")
        if not args.schema_compatible_with:
            raise RuntimeError("Rollback requires schema review and --schema-compatible-with from the current status fingerprint.")
    else:
        if bool(args.image) != bool(args.migration_image):
            raise RuntimeError("Supply runtime and migration image references together.")
        target = {"image": args.image, "migration_image": args.migration_image} if args.image else None
    deployment = Deployment(args, target)
    if state.get("project") and state["project"] != deployment.config["name"]:
        raise RuntimeError("The Compose project differs from the recorded release; retain its database volume and configuration.")
    if args.command == "status":
        rows = deployment.history()
        print(json.dumps({"origin": deployment.origin, "schema_fingerprint": fingerprint(rows), "state": state}, indent=2))
        return
    with deployment_lock(env_file.parent / ".deployment.lock"):
        # Reload after acquiring the lock so concurrent commands never use stale release state.
        latest = json.loads(state_file.read_text(encoding="utf-8")) if state_file.exists() else {}
        if latest != state:
            raise RuntimeError("Release state changed; inspect status and retry.")
        if not args.no_pull:
            print("Pulling target images before changing any running application...", flush=True)
            services = ("app", "migrate") if args.command == "rollback" else ("app", "migrate", "proxy", "postgres")
            deployment.compose("pull", *services, timeout=900)
        pair = deployment.inspect_pair()
        if args.command == "rollback" and any(pair[key] != target.get(key) for key in ("image_id", "migration_image_id")):
            raise RuntimeError("Rollback image content differs from the previously verified release; use its recorded digest.")
        manifest = deployment.manifest()
        if args.command == "deploy":
            deployment.compose("up", "-d", "--wait", "--wait-timeout", str(args.timeout), "--pull", "never", "postgres")
        rows = deployment.history()
        check_history(rows, manifest, rollback=args.command == "rollback")
        if args.command == "rollback" and args.schema_compatible_with != fingerprint(rows):
            raise RuntimeError("The schema compatibility acknowledgement does not match the current database.")
        deployment.compose("run", "--rm", "--no-deps", "--pull", "never", "proxy", "caddy", "validate",
                           "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")
        state["project"] = deployment.config["name"]
        state["pending"] = {**pair, "phase": "before-migrations", "schema_fingerprint": fingerprint(rows)}
        save = lambda: atomic_write(state_file, json.dumps(state, indent=2) + "\n")
        save()
        try:
            if args.command == "deploy":
                print("Applying production migrations once, before switching the application...", flush=True)
                deployment.compose("run", "--rm", "--no-deps", "--pull", "never", "migrate")
                rows = deployment.history()
                if rows != manifest:
                    raise RuntimeError("Applied migration history does not match the target image.")
            state["pending"].update(phase="starting-app", schema_fingerprint=fingerprint(rows))
            save()
            deployment.compose("up", "-d", "--no-deps", "--wait", "--wait-timeout", str(args.timeout), "--pull", "never", "app")
            deployment.compose("up", "-d", "--no-deps", "--pull", "never", "proxy")
            deadline = time.monotonic() + args.timeout
            while True:
                try:
                    check_ready(deployment.origin, args.ca_file)
                    break
                except Exception:
                    if time.monotonic() >= deadline:
                        raise RuntimeError("HTTPS /ready did not recover; no automatic rollback was attempted.") from None
                    time.sleep(2)
        except Exception:
            state["pending"]["phase"] = "failed"
            save()
            raise
        current = state.get("current")
        previous = current if current and current.get("image_id") != pair["image_id"] else state.get("previous")
        state = {"project": deployment.config["name"], "current": {**pair, "schema_fingerprint": fingerprint(rows)}, "previous": previous,
                 "deployed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        update_images(env_file, pair)
        save()
        print(json.dumps({"status": "ready", "origin": deployment.origin, "revision": pair["revision"],
                          "schema_fingerprint": fingerprint(rows)}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("deploy", "rollback", "status"))
    parser.add_argument("--env-file", default=str(ROOT / ".env"))
    parser.add_argument("--image")
    parser.add_argument("--migration-image")
    parser.add_argument("--expected-origin")
    parser.add_argument("--schema-compatible-with", help="Current status fingerprint, after reviewing backward compatibility")
    parser.add_argument("--ca-file", help="Trusted private CA for local/test HTTPS; certificate verification stays enabled")
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--no-pull", action="store_true", help="Use already-loaded images for isolated tests or reviewed offline recovery")
    args = parser.parse_args()
    try:
        if args.timeout < 5 or args.timeout > 600:
            raise RuntimeError("Timeout must be between 5 and 600 seconds.")
        execute(args)
    except (Exception, KeyboardInterrupt) as error:
        # No traceback, process arguments containing secrets, config dumps, or raw API responses.
        frames = [frame for frame in traceback.extract_tb(error.__traceback__) if frame.filename == __file__]
        location = f" at line {frames[-1].lineno}" if frames else ""
        print(str(error) if isinstance(error, RuntimeError) else f"Deployment failed ({type(error).__name__}{location}); inspect server configuration and service status.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
