# Self-hosted portfolio data

The portfolio API now uses PostgreSQL and files on the Hunterstar VPS. The browser
client still uses the historical `window.firebaseConfig` name for compatibility;
it sends HTTP requests to the VPS and does not load Firebase.

## Server layout

- Database cluster: PostgreSQL 16 `portfolio`, loopback port 5433.
- Database files: `/opt/portfolio-api/memory/pgdata`.
- Database: `portfolio`; restricted application role: `portfolio_api`.
- Uploaded files: `/opt/portfolio-api/bucket`.
- Configuration: `/opt/portfolio-api/.env` (permissions 600).
- API: `https://api.hunterstar.uz`; health reports `postgresql` and `local`.
- Other VPS databases stay in their existing PostgreSQL cluster on port 5432.

Firestore documents retain collection names, document IDs, and all fields in the
`documents` JSONB table. Timestamp seconds/nanoseconds and special Firestore types
are preserved. The `users` table stores exported password hashes and their hash
settings. Password verification runs locally using Node crypto, following the
[Firebase scrypt algorithm](https://github.com/firebase/scrypt). Existing UIDs and
both authenticator secrets are retained, so passwords and 2FA codes stay valid.
`files` stores object metadata; HTTP downloads support tokens and byte ranges.
The account queue keeps its previous public access and refreshes every 15 seconds.

## Deployment

Both `deploy.bat` and `api/deploy-vps.ps1` ship the PostgreSQL modules and install
dependencies. Full deployment preserves `.env` instead of regenerating credentials.
`setup-postgres.sh` initializes a separate portfolio cluster on first install.
Firebase Admin is needed only to run `migrate-firebase.js`, not by the live API.
The production install omits this development dependency and the service account.

Never put the bucket, database directories, exports, or `.env` into Git/Vercel.
They are excluded from deployment and version control.

## Backups and recovery

Run `bash /opt/portfolio-api/backup-selfhosted.sh` as root. It creates a PostgreSQL
custom dump, bucket archive, and environment copy under `/root/portfolio-backups`.
Copy backups to another machine for protection against losing the VPS.
The local backup destination is `api/backups/migration-20261005` on the development
computer. Database, configuration, and Firebase export copies are saved there.
Use the full bucket archive only after its SCP transfer has completed. This
directory is ignored by Git and Vercel.

The original code/configuration and the complete Firebase export are preserved
under `/root/portfolio-migration-backup`. Firebase source data was copied, not
deleted. Do not rerun the Firebase importer after writing new PostgreSQL data: it
overwrites records with matching IDs. A deliberate maintenance window is required
for another import or restore.

Restore a backup into a new database for verification with `pg_restore`, then stop
the API and switch DATABASE_URL to the restored database. Extract the matching
bucket archive and restore the matching `.env` only as part of that maintenance
operation. Do not restore directly over a running database or mix versions of the
database and file archive.

## Checks

`npm --prefix api test` verifies local password hashing, disabled accounts, file
path protections, and AI behavior. `api/test-migration.cjs` is a separate integration
check for a test API on port 3002; it inserts uniquely named temporary records and
cleans them up. It tests database merge/filter/order/batch semantics, login and 2FA,
uploads, protected/range downloads, diary writes, queue CRUD, and contact messages.
