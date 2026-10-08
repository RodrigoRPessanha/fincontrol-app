"""Read-only PostgreSQL export -> age encryption -> private Cloudflare R2.

Requires native PostgreSQL 17 clients, age, AWS CLI and Python 3. No Docker.
Never prints subprocess output: database errors can contain private records.
"""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone
from uuid import uuid4


PROJECTS = {
    'staging': 'iwesoczokkycjovyknnz',
    'production': 'exvjusubjjvjcdxtjfgf',
}
ROOT = Path(__file__).resolve().parents[1]
SSL_ROOT_CERT = ROOT / 'supabase' / 'certs' / 'prod-ca-2021.crt'


def require(env, name):
    value = env.get(name, '')
    if not value:
        raise ValueError(f'{name} is required')
    return value


def configuration(env):
    source = require(env, 'BACKUP_SOURCE')
    if source not in PROJECTS:
        raise ValueError('BACKUP_SOURCE must be staging or production')
    ref = PROJECTS[source]
    host = require(env, 'PGHOST')
    user = require(env, 'PGUSER')
    direct = host == f'db.{ref}.supabase.co' and user == 'backup_reader'
    pooler = bool(re.fullmatch(r'aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com', host))
    if not (direct or (pooler and user == f'backup_reader.{ref}')):
        raise ValueError('Database host/user do not identify the selected project')
    if env.get('PGPORT') != '5432' or env.get('PGDATABASE') != 'postgres':
        raise ValueError('Use database postgres and direct/session port 5432')
    require(env, 'PGPASSWORD')
    account = require(env, 'R2_ACCOUNT_ID')
    if not re.fullmatch(r'[a-f0-9]{32}', account):
        raise ValueError('Invalid R2 account ID')
    bucket = require(env, 'R2_BUCKET')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]', bucket):
        raise ValueError('Invalid R2 bucket name')
    recipient = require(env, 'BACKUP_AGE_RECIPIENT')
    if not re.fullmatch(r'age1[0-9a-z]{58}', recipient):
        raise ValueError('Use an age X25519 public recipient, never a private key')
    require(env, 'AWS_ACCESS_KEY_ID')
    require(env, 'AWS_SECRET_ACCESS_KEY')
    output = Path(require(env, 'BACKUP_OUTPUT_DIR')).resolve()
    if output == ROOT or ROOT in output.parents:
        raise ValueError('BACKUP_OUTPUT_DIR must be outside the repository')
    return source, ref, account, bucket, recipient, output


def execute(args, env, timeout=600):
    try:
        result = subprocess.run(args, env=env, capture_output=True, timeout=timeout,
                                check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError(f'{Path(args[0]).name} could not complete') from None
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed; private output suppressed')
    return result.stdout


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def backup(env):
    source, ref, account, bucket, recipient, output = configuration(env)
    if not SSL_ROOT_CERT.is_file():
        raise RuntimeError('Official Supabase CA file is missing; TLS verification is required')
    # No cloud-storage credentials in database/encryption subprocesses, and no
    # database password in upload subprocesses. Never use a connection URL argv.
    common = {key: value for key, value in env.items()
              if key in ('PATH', 'HOME', 'SYSTEMROOT', 'TEMP', 'TMP', 'LANG')}
    db_env = {**common, **{key: env[key] for key in
              ('PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD')},
              'PGSSLMODE': 'verify-full', 'PGSSLROOTCERT': str(SSL_ROOT_CERT),
              'PGCONNECT_TIMEOUT': '20', 'PGAPPNAME': 'fincontrol-backup'}
    versions = {}
    for tool in ('pg_dump', 'pg_dumpall', 'pg_restore', 'psql'):
        version = execute([tool, '--version'], common).decode().strip()
        if not re.search(r'\(PostgreSQL\) 17\.', version):
            raise RuntimeError('PostgreSQL 17 client tools are required')
        versions[tool] = version
    server = execute(['psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                      '-c', 'SHOW server_version_num'], db_env).decode().strip()
    if not server.isdigit() or int(server) // 10000 != 17:
        raise RuntimeError('Expected PostgreSQL 17 server; review tools before backup')
    # Defaults such as transaction_read_only can be changed by the session.
    # Validate the actual role/ACLs instead of treating that default as a sandbox.
    role_check = execute(['psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', '''
SELECT json_build_object(
  'identity_ok', current_user = 'backup_reader',
  'role_ok', NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
             AND NOT rolreplication AND rolbypassrls AND rolcanlogin,
  'read_all', pg_has_role(current_user, 'pg_read_all_data', 'USAGE'),
  'unsafe_memberships', (SELECT count(*) FROM pg_roles r
      WHERE r.rolname NOT IN ('backup_reader', 'pg_read_all_data')
      AND pg_has_role(current_user, r.oid, 'MEMBER')),
  'owned_objects', (SELECT count(*) FROM pg_shdepend WHERE refobjid = role.oid
      AND refclassid = 'pg_authid'::regclass AND deptype = 'o'),
  'database_create', has_database_privilege(current_user, current_database(), 'CREATE'),
  'schema_create', (SELECT count(*) FROM pg_namespace n
      WHERE n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'
      AND has_schema_privilege(current_user, n.oid, 'CREATE')),
  'writable_tables', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
      AND has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')),
  'staging_cron_delete_only', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='cron' AND c.relname='job_run_details' AND c.relkind='r'
      AND pg_get_userbyid(c.relowner)='supabase_admin'
      AND has_table_privilege(current_user, c.oid, 'DELETE')
      AND NOT has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,TRUNCATE,TRIGGER,REFERENCES,DELETE WITH GRANT OPTION')),
  'writable_sequences', (SELECT count(*) FROM pg_class c WHERE c.relkind='S'
      AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(current_user, c.oid, 'USAGE,UPDATE') ELSE false END),
  'callable_definers', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')
      AND has_function_privilege(current_user, p.oid, 'EXECUTE'))
) FROM pg_roles role WHERE rolname = current_user;
'''], db_env).decode().strip()
    try:
        permissions = json.loads(role_check)
    except (ValueError, TypeError):
        raise RuntimeError('Could not verify backup role permissions') from None
    # Explicit staging-only acceptance: inherited DELETE on pg_cron history,
    # never another write privilege, grant option, object, or production role.
    cron_exception = (isinstance(permissions, dict) and source == 'staging'
                      and permissions.get('staging_cron_delete_only') == 1
                      and permissions.get('writable_tables') == 1)
    if not isinstance(permissions, dict) or any(
        permissions.get(name) is not True for name in ('identity_ok', 'role_ok', 'read_all')
    ) or any(permissions.get(name) != 0 for name in (
        'unsafe_memberships', 'owned_objects', 'database_create', 'schema_create',
        'writable_sequences', 'callable_definers'
    )) or (permissions.get('writable_tables') != 0 and not cron_exception) or (
        permissions.get('staging_cron_delete_only') not in (0, 1)
    ):
        raise RuntimeError('Backup role privileges require review; export blocked')
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    started = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    filename = f'{started}-{uuid4().hex}.tar.age'
    encrypted = output / filename
    key = f'{source}/{ref}/{filename}'
    # All plaintext stays in a private temporary directory and is cleaned on
    # success/failure. Only the encrypted archive is allowed to reach R2.
    with tempfile.TemporaryDirectory(prefix='fincontrol-backup-') as temp:
        work = Path(temp)
        dump = work / 'database.dump'
        execute(['pg_dump', '--format=custom', '--lock-wait-timeout=30000',
                 '--file', str(dump)], db_env)
        toc = execute(['pg_restore', '--list', str(dump)], common).decode()
        for marker in ('TABLE public transactions', 'TABLE auth users',
                       'TABLE supabase_migrations schema_migrations'):
            if marker not in toc:
                raise RuntimeError('Archive lacks required application/Auth/history tables')
        (work / 'contents.list').write_text(toc, encoding='utf-8')
        execute(['pg_dumpall', '--roles-only', '--no-role-passwords',
                 '--file', str(work / 'roles.sql')], db_env)
        parts = ('database.dump', 'roles.sql', 'contents.list')
        manifest = {
            'format': 1, 'source': source, 'project_ref': ref,
            'started_at_utc': started, 'server_version_num': server,
            'clients': versions, 'git_sha': env.get('GITHUB_SHA', 'local'),
            'files': {name: {'sha256': digest(work / name),
                             'bytes': (work / name).stat().st_size} for name in parts},
            'restore_verified': False,
            'accepted_permission_exceptions': (
                ['staging: DELETE on cron.job_run_details (no grant option)'] if cron_exception else []
            ),
            'limitations': ['Role passwords and external project settings are excluded',
                            'Storage object payloads and Vault root keys are excluded',
                            'Managed schemas/extensions require a reviewed restore plan'],
        }
        (work / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        package = work / 'backup.tar'
        with tarfile.open(package, 'w') as archive:
            for name in (*parts, 'manifest.json'):
                archive.add(work / name, arcname=name)
        try:
            execute(['age', '--recipient', recipient, '--output', str(encrypted),
                     str(package)], common)
            if encrypted.stat().st_size == 0:
                raise RuntimeError('Empty encrypted archive')
            checksum = digest(encrypted)
            upload_env = {**common, 'AWS_ACCESS_KEY_ID': env['AWS_ACCESS_KEY_ID'],
                          'AWS_SECRET_ACCESS_KEY': env['AWS_SECRET_ACCESS_KEY'],
                          'AWS_DEFAULT_REGION': 'auto', 'AWS_EC2_METADATA_DISABLED': 'true',
                          'AWS_PAGER': ''}
            endpoint = f'https://{account}.r2.cloudflarestorage.com'
            execute(['aws', '--endpoint-url', endpoint, 's3', 'cp', str(encrypted),
                     f's3://{bucket}/{key}', '--only-show-errors', '--metadata',
                     f'sha256={checksum}', '--content-type', 'application/octet-stream'], upload_env)
            # Download and hash the stored ciphertext, rather than relying on
            # ETag (multipart ETags are not a file checksum).
            downloaded = work / 'verification.age'
            execute(['aws', '--endpoint-url', endpoint, 's3', 'cp',
                     f's3://{bucket}/{key}', str(downloaded), '--only-show-errors'], upload_env)
            if digest(downloaded) != checksum:
                raise RuntimeError('R2 downloaded checksum differs; backup NOT verified')
        finally:
            encrypted.unlink(missing_ok=True)
    return {'object_key': key, 'sha256': checksum, 'restore_verified': False}


if __name__ == '__main__':
    try:
        print(json.dumps(backup(dict(os.environ)), indent=2))
    except (ValueError, RuntimeError) as error:
        # Only our own validation/process messages, never captured stderr.
        print(f'Backup failed: {error}. No restore was performed.')
        raise SystemExit(1) from None
    except OSError:
        print('Backup failed: local file operation failed. No restore was performed.')
        raise SystemExit(1) from None
