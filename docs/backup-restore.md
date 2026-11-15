# PostgreSQL backup and restore

Use [deploy/backup.py](../deploy/backup.py) on the server from the directory containing `compose.yaml`, `deploy.py`, and the private `.env`. Python 3.11+ and Docker Compose are required; it invokes PostgreSQL 18's tools inside the running database container. The database port stays private. No host `pg_dump` installation, command-line password, shell pipe, or PowerShell binary redirection is required.

The helper creates a transactionally consistent custom-format logical dump of the configured database, including CRM records, staff password hashes, constraints, sequences/defaults, and Prisma migration history. **Live `public.session` rows are excluded**; the table/indexes remain, and staff must sign in again after a recovery. Roles, role passwords, Docker volumes, Grafana history, Caddy certificates, `.env`, and release-state files are separate recovery assets. Preserve those privately using your server secret/configuration backup process. A logical dump is not continuous point-in-time recovery.

## Create and retain a backup

`python3 backup.py backup` writes a new UTC-named archive and adjacent JSON checksum/schema metadata under the ignored `backups/` directory and verifies that PostgreSQL can read its archive catalogue.

```sh
python3 backup.py backup
```

The command uses binary file streams on Windows and Linux, creates files with private POSIX permissions, refuses existing output paths, and holds the deployment lock to avoid an application-controlled migration during the dump. PostgreSQL's snapshot permits ordinary CRM writes; coordinate any manual DDL separately. On Windows, restrict the archive directory's NTFS ACL to the intended operator. Treat an archive as successful only when the command exits zero with `backup_created`; an interrupted/failed backup is not a recovery point.

`python3 backup.py backup --output /secure-backups/crm-before-release.dump` selects a new operator-controlled output path for a pre-release backup; replace the directory/name and retain the matching `.dump.json` file.

```sh
python3 backup.py backup --output /secure-backups/crm-before-release.dump
```

The archive contains personal data and password hashes and is **not encrypted by this helper**. Encrypt it and its metadata with your approved backup system, copy off-host to access-controlled storage, and verify the off-host copy can be retrieved and decrypted. The SHA-256 sidecar detects accidental corruption; it is not a signature or a substitute for trusted storage. Do not commit archives, attach them to issues, publish them in CI artifacts, or put them in the Pages build. The Docker context excludes backup directories. Synthetic disposable archives are removed by the integration verifier.

Choose and record an owner, schedule, retention, encryption key recovery process, RPO and RTO before production use. For example, a daily retained backup gives at most daily snapshot granularity only when every scheduled run and off-host copy succeeds. Monitor backup exit status, storage capacity and age of the newest verified off-host copy. This repository does not claim that a hosted scheduler or off-host destination has been configured.

## Restore into an isolated, new database

Retrieve the archive and sidecar into a private directory on a trusted recovery/staging host using the same PostgreSQL major version first. Keep it disconnected from public app traffic. Use a distinct lowercase target name: the helper rejects the configured source database, system databases, invalid names, and **any already-existing target**. It never issues `DROP`, `--clean`, or overwrites a database.

`python3 backup.py restore --input /secure-backups/crm-before-release.dump --database crm_restore_check --confirm-new-database crm_restore_check` verifies the checksum, creates a new database, restores in one transaction, checks migration history, and reports record counts with zero sessions.

```sh
python3 backup.py restore --input /secure-backups/crm-before-release.dump --database crm_restore_check --confirm-new-database crm_restore_check
```

`restore_verified` means the archive restored, its applied migration names/checksums match the sidecar, and the expected tables can be counted; it does not establish business completeness for a real archive. Compare counts and selected known records against the backup's recovery point, verify contact→lead→opportunity links, exact EGP decimal values and date-only close dates, and confirm constraints and an authorized staff login. Choose an application image compatible with the archived migration history; do not blindly apply a newer image or reset migration history. A failed transaction leaves the newly created target for private inspection; select a fresh name for another attempt. No source database is modified.

For a real recovery, stop writes and plan the downtime/cutover explicitly. Start an isolated app using the restored database and the reviewed image, run health/readiness and authorized smoke checks, then change the server's `POSTGRES_DB`/connection configuration through the deployment process and verify the HTTPS app before reopening traffic. Keep the original database/volume available until recovery is accepted. Reconcile private release state with the selected image and restored migration fingerprint; do not reuse an acknowledgement for a different schema. Recovery of an unavailable server also requires the separately retained secrets/configuration and Docker infrastructure. Avoid an in-place overwrite as an incident shortcut.

## Repeatable synthetic restore drill

`python -m unittest discover -s deploy -p 'test_*.py' -v` verifies archive corruption/session-policy rejection, restore target restrictions, secret preservation, and release validation with temporary synthetic files.

```sh
python -m unittest discover -s deploy -p 'test_*.py' -v
```

`npm run test:production --workspace backend` executes the real backup/restore helper in its disposable PostgreSQL stack after creating an authenticated contact, a lead scored 8, and an EGP `123456.78` opportunity dated `2028-02-29`, then closing the lead as Closed Won.

```sh
npm run test:production --workspace backend
```

The drill compares the restored contact identity/email, closed stage, score, parent relationships, exact decimal/date and migration history, checks restored score/value/foreign-key constraints, and confirms source/existing database restoration is refused. Expected restored counts are **1 contact, 1 lead, 1 opportunity, 1 user, 0 sessions** while the source has an active session. All data is synthetic; only the verifier's own randomly named containers, volumes and temporary archive are removed. Repeat this drill on the actual backup destination/staging host before calling the hosted recovery process verified.
