"""Backup safety contracts. No network, credentials, Docker or PostgreSQL required."""

import importlib.util
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('backup_cloud', Path(__file__).parents[1] / 'backup_cloud.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = {
            'BACKUP_SOURCE': 'staging',
            'PGHOST': 'aws-0-sa-east-1.pooler.supabase.com',
            'PGPORT': '5432', 'PGDATABASE': 'postgres',
            'PGUSER': 'backup_reader.iwesoczokkycjovyknnz', 'PGPASSWORD': 'db-test-secret',
            'R2_ACCOUNT_ID': 'a' * 32, 'R2_BUCKET': 'fincontrol-backups',
            'BACKUP_AGE_RECIPIENT': 'age1' + 'q' * 58,
            'BACKUP_OUTPUT_DIR': self.temp.name,
            'AWS_ACCESS_KEY_ID': 'r2-test-id', 'AWS_SECRET_ACCESS_KEY': 'r2-test-secret',
        }

    def test_rejects_wrong_project_port_host_and_repository_output(self):
        for name, value in [('BACKUP_SOURCE', 'production'), ('PGPORT', '6543'),
                            ('PGHOST', 'attacker.example'),
                            ('PGUSER', 'postgres.iwesoczokkycjovyknnz'),
                            ('BACKUP_OUTPUT_DIR', str(module.ROOT / 'output')),
                            ('BACKUP_AGE_RECIPIENT', 'AGE-SECRET-KEY-test')]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                module.configuration({**self.env, name: value})

    def test_invalid_configuration_never_runs_a_process(self):
        with patch.object(module, 'execute') as execute, self.assertRaises(ValueError):
            module.backup({**self.env, 'PGPASSWORD': ''})
        execute.assert_not_called()

    def test_diagnostic_address_must_match_current_supabase_dns(self):
        addresses = [(module.socket.AF_INET, module.socket.SOCK_STREAM, 6, '', ('203.0.113.10', 5432))]
        with patch.object(module.socket, 'getaddrinfo', return_value=addresses):
            module.configuration({**self.env, 'PGHOSTADDR': '203.0.113.10'})
            with self.assertRaisesRegex(ValueError, 'not in current Supabase DNS'):
                module.configuration({**self.env, 'PGHOSTADDR': '203.0.113.11'})

    def test_process_error_does_not_disclose_private_output(self):
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess(
                ['pg_dump'], 1, b'', b'password or private row')):
            with self.assertRaisesRegex(RuntimeError, '^pg_dump failed; private output suppressed$'):
                module.execute(['pg_dump'], {})

    def test_connection_diagnostics_never_echo_server_text(self):
        for message, expected in [
            (b'password authentication failed for private-user', 'authentication rejected'),
            (b'certificate verify failed: private-path', 'TLS certificate verification failed'),
            (b'connection timed out: private-host', 'network timeout'),
            (b'tenant or user not found: private-user', 'pooler user/project not found'),
        ]:
            with self.subTest(expected=expected):
                self.assertEqual(module.connection_error_kind(message), expected)

    def fake_execute(self, args, env, timeout=600):
        self.calls.append((args, env))
        tool = args[0]
        if tool in ('pg_dump', 'pg_dumpall', 'pg_restore', 'psql'):
            self.assertNotIn('AWS_SECRET_ACCESS_KEY', env)
        if '--version' in args:
            return f'{tool} (PostgreSQL) 17.6'.encode()
        if tool in ('pg_dump', 'pg_dumpall', 'psql'):
            self.assertIn('--no-password', args)
            self.assertIn('tcp_user_timeout=30000', args[args.index('--dbname') + 1])
        if tool == 'psql':
            self.assertEqual(env['PGSSLMODE'], 'verify-full')
            self.assertEqual(env['PGSSLROOTCERT'], str(module.SSL_ROOT_CERT))
            if 'json_build_object' in args[-1]:
                return json.dumps({
                    'identity_ok': True, 'role_ok': True, 'read_all': True,
                    'unsafe_memberships': 0, 'owned_objects': 0,
                    'database_create': False, 'schema_create': 0,
                    'writable_tables': 0, 'writable_sequences': 0, 'callable_definers': 0,
                    'cron_delete_only': 0,
                }).encode()
            return b'170006\n'
        if tool == 'pg_restore':
            return b'TABLE public transactions\nTABLE auth users\nTABLE supabase_migrations schema_migrations\n'
        if tool in ('pg_dump', 'pg_dumpall'):
            Path(args[args.index('--file') + 1]).write_bytes(b'private test data')
        if tool == 'age':
            self.assertNotIn('PGPASSWORD', env)
            with tarfile.open(args[-1]) as archive:
                manifest = json.load(archive.extractfile('manifest.json'))
                self.assertFalse(manifest['restore_verified'])
                self.assertEqual(set(manifest['files']), {'database.dump', 'roles.sql', 'contents.list'})
            Path(args[args.index('--output') + 1]).write_bytes(b'mocked ciphertext')
        if tool == 'aws':
            self.assertNotIn('PGPASSWORD', env)
            source, target = args[5:7]
            if source.startswith('s3://'):
                Path(target).write_bytes(self.remote)
            else:
                self.remote = Path(source).read_bytes()
        return b''

    def test_only_ciphertext_uploaded_and_local_files_cleaned(self):
        self.calls = []
        with patch.object(module, 'execute', side_effect=self.fake_execute):
            result = module.backup(self.env)
        self.assertTrue(result['object_key'].startswith('staging/iwesoczokkycjovyknnz/'))
        self.assertFalse(result['restore_verified'])
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])
        self.assertEqual(len([args for args, _ in self.calls if args[0] == 'aws']), 2)
        for args, _ in self.calls:
            self.assertNotIn('db-test-secret', ' '.join(args))
            self.assertNotIn('r2-test-secret', ' '.join(args))

    def test_failed_export_never_encrypts_or_uploads(self):
        self.calls = []
        def fail(args, env, timeout=600):
            if args[0] == 'pg_dump' and '--file' in args:
                raise RuntimeError('export refused')
            return self.fake_execute(args, env, timeout)
        with patch.object(module, 'execute', side_effect=fail), self.assertRaises(RuntimeError):
            module.backup(self.env)
        self.assertFalse(any(args[0] in ('age', 'aws') for args, _ in self.calls))

    def test_inherited_write_or_definer_access_blocks_export(self):
        for permission in ('unsafe_memberships', 'database_create', 'schema_create',
                           'owned_objects', 'writable_tables', 'writable_sequences', 'callable_definers'):
            with self.subTest(permission=permission):
                self.calls = []
                def unsafe(args, env, timeout=600):
                    result = self.fake_execute(args, env, timeout)
                    if args[0] == 'psql' and 'json_build_object' in args[-1]:
                        parsed = json.loads(result)
                        parsed[permission] = 1
                        return json.dumps(parsed).encode()
                    return result
                with patch.object(module, 'execute', side_effect=unsafe), self.assertRaisesRegex(
                        RuntimeError, 'privileges require review'):
                    module.backup(self.env)
                self.assertFalse(any('--file' in args for args, _ in self.calls))

    def test_corrupted_remote_copy_fails_and_cleans_local_ciphertext(self):
        self.calls = []
        def corrupt(args, env, timeout=600):
            result = self.fake_execute(args, env, timeout)
            if args[0] == 'aws' and args[5].startswith('s3://'):
                Path(args[6]).write_bytes(b'corrupt')
            return result
        with patch.object(module, 'execute', side_effect=corrupt):
            with self.assertRaisesRegex(RuntimeError, 'checksum differs'):
                module.backup(self.env)
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_cron_delete_exception_requires_production_opt_in(self):
        for source, tables, flag, accepted in [('staging', 1, '', True), ('staging', 2, '', False),
                                               ('production', 1, '', False), ('production', 1, 'true', True),
                                               ('production', 2, 'true', False), ('production', 1, 'false', False)]:
            with self.subTest(source=source, tables=tables, flag=flag):
                self.calls = []
                env = {**self.env, 'BACKUP_SOURCE': source,
                       'BACKUP_ALLOW_CRON_LOG_DELETE': flag,
                       'PGUSER': f'backup_reader.{module.PROJECTS[source]}'}
                def cron_permissions(args, process_env, timeout=600):
                    result = self.fake_execute(args, process_env, timeout)
                    if args[0] == 'psql' and 'json_build_object' in args[-1]:
                        parsed = json.loads(result)
                        parsed.update(writable_tables=tables, cron_delete_only=1)
                        return json.dumps(parsed).encode()
                    return result
                with patch.object(module, 'execute', side_effect=cron_permissions):
                    if accepted:
                        module.backup(env)
                    else:
                        with self.assertRaisesRegex(RuntimeError, 'privileges require review'):
                            module.backup(env)
                        self.assertFalse(any('--file' in args for args, _ in self.calls))


if __name__ == '__main__':
    unittest.main()
