import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Carrega variáveis de .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
  console.error('ERRO: NEXT_PUBLIC_SUPABASE_URL e chave pública do Supabase são obrigatórios.');
  process.exit(1);
}

// Obtém a service_role key em memória diretamente da CLI autenticada (sem gravar em arquivo nem expor em logs)
function getServiceRoleKey() {
  try {
    const out = execSync(
      'cmd /c npx supabase projects api-keys --project-ref iwesoczokkycjovyknnz --reveal --output json',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const keys = JSON.parse(out);
    const sr = keys.find((k) => k.name === 'service_role' || k.tags?.includes('service_role'));
    if (!sr?.api_key) {
      throw new Error('Chave service_role não encontrada no projeto fincontrol-staging.');
    }
    return sr.api_key;
  } catch (err) {
    console.error('ERRO: Falha ao obter credencial administrativa via Supabase CLI:', err.message);
    return null;
  }
}

// Helper para consultas estritamente READ-ONLY (SELECT) no banco remoto
function runReadOnlySql(sql) {
  if (!sql.trim().toUpperCase().startsWith('SELECT')) {
    throw new Error('Segurança: runReadOnlySql aceita exclusivamente instruções SELECT.');
  }
  const tmpFile = path.resolve(
    process.cwd(),
    'scripts',
    `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.sql`
  );
  fs.writeFileSync(tmpFile, sql, 'utf8');
  try {
    const cmd = `cmd /c npx supabase db query --linked --file "${tmpFile}"`;
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const jsonMatch = out.match(/\{[\s\S]*"rows"[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } finally {
    if (fs.existsSync(tmpFile)) {
      try {
        fs.unlinkSync(tmpFile);
      } catch (_) {}
    }
  }
}

async function runAuthGate() {
  console.log('================================================================');
  console.log('  TESTE DE AUTENTICAÇÃO REAL NO SUPABASE CLOUD (fincontrol-staging)');
  console.log('  Modo: 100% via Token Criptográfico (Sem envio SMTP / Sem Bounces)');
  console.log('================================================================\n');

  // 1. Verificação Estrita de Credenciais Administrativas
  console.log('1. Verificando disponibilidade da credencial administrativa (service_role)...');
  const serviceRoleKey = getServiceRoleKey();
  if (!serviceRoleKey) {
    console.error('\n❌ BLOQUEIO DE SEGURANÇA:');
    console.error('A credencial administrativa (service_role) é obrigatória para testar links e tokens sem disparar e-mails SMTP.');
    console.error('Nenhum fallback com envio de e-mail ou alteração SQL em auth.users é permitido.');
    process.exit(1);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (!adminClient?.auth?.admin?.generateLink) {
    console.error('\n❌ ERRO: admin.generateLink não está disponível no cliente administrativo.');
    process.exit(1);
  }
  console.log('   OK: Credencial administrativa validada com sucesso.');

  const testEmail = `test.gate.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@fincontrol.app`;
  const initialPassword = 'InitialPassword123!';
  const updatedPassword = 'UpdatedPassword456!';

  let userId = null;

  try {
    // 2. Cadastro e Emissão Criptográfica do Link de Confirmação (Zero SMTP)
    console.log(`\n2. Criando usuário e gerando link de confirmação para ${testEmail}...`);
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'signup',
      email: testEmail,
      password: initialPassword,
      options: { data: { name: 'Gate Test User' } },
    });

    if (linkError || !linkData.user?.id) {
      throw new Error(`Falha ao gerar link de cadastro via admin.generateLink: ${linkError?.message}`);
    }

    userId = linkData.user.id;
    const confirmationTokenHash = linkData.properties?.hashed_token;

    if (!confirmationTokenHash) {
      throw new Error('Falha: admin.generateLink não retornou hashed_token para confirmação.');
    }

    console.log(`   OK: Usuário criado no Cloud Auth (ID: ${userId}).`);
    console.log('   OK: Link de confirmação e token_hash gerados criptograficamente pelo GoTrue Cloud (0 e-mails enviados).');

    // 3. Validação do Bloqueio por E-mail Não Confirmado
    console.log('\n3. Validando Bloqueio de Login com E-mail Não Confirmado...');
    const { error: unconfError } = await anonClient.auth.signInWithPassword({
      email: testEmail,
      password: initialPassword,
    });
    if (!unconfError) {
      throw new Error('Falha de segurança: login foi aceito antes da confirmação do e-mail.');
    }
    console.log(`   OK: Bloqueio validado com sucesso pelo GoTrue Cloud (${unconfError.message}).`);

    // 4. Confirmação do E-mail via Token Hash (verifyOtp - Simulação Exata do Clique no Link)
    console.log('\n4. Testando Confirmação de E-mail via Token de Verificação (verifyOtp)...');
    const clientAfterConfirm = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: verifyData, error: verifyError } = await clientAfterConfirm.auth.verifyOtp({
      token_hash: confirmationTokenHash,
      type: 'signup',
    });

    if (verifyError || !verifyData.user?.email_confirmed_at) {
      throw new Error(`Falha ao verificar token do link de cadastro: ${verifyError?.message}`);
    }
    console.log(`   OK: Token do link validado pelo GoTrue Cloud em ${verifyData.user.email_confirmed_at}.`);
    console.log('   OK: Sessão pós-confirmação estabelecida com sucesso.');

    // 5. Login com Usuário Confirmado
    console.log('\n5. Testando Login (signInWithPassword) com usuário confirmado...');
    const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
      email: testEmail,
      password: initialPassword,
    });
    if (signInError || !signInData.session?.access_token) {
      throw new Error(`Falha no login com usuário confirmado: ${signInError?.message}`);
    }
    console.log('   OK: Login autenticado com sucesso no Supabase Cloud GoTrue.');
    console.log(`   OK: Sessão JWT gerada (Token Type: bearer, Expira em: ${signInData.session.expires_in}s).`);

    // 6. Verificação de Sessão Ativa
    console.log('\n6. Verificando Validação de Sessão (getUser) no Cloud...');
    const userSessionClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await userSessionClient.auth.setSession({
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
    });

    const { data: userData, error: userError } = await userSessionClient.auth.getUser();
    if (userError || !userData.user) {
      throw new Error(`Falha ao obter usuário autenticado via token: ${userError?.message}`);
    }
    console.log(`   OK: Token validado pelo Cloud Auth (Usuário: ${userData.user.email}, ID: ${userData.user.id}).`);

    // 7. Logout (signOut) com Verificação Explícita de Invalidação
    console.log('\n7. Testando Logout (signOut) e Verificação de Invalidação de Sessão...');
    const { error: signOutError } = await userSessionClient.auth.signOut();
    if (signOutError) {
      throw new Error(`Falha no signOut: ${signOutError.message}`);
    }

    const { data: postSignOutData } = await userSessionClient.auth.getUser();
    if (postSignOutData?.user) {
      throw new Error('Falha de logout: usuário ainda consta como ativo após signOut.');
    }
    console.log('   OK: Sessão finalizada com sucesso (getUser retorna nulo / sessão encerrada).');

    // 8. Recuperação de Senha por Link Oficial, Callback e Redefinição (Zero SMTP)
    console.log('\n8. Testando Fluxo de Recuperação por Link Oficial e Redefinição...');
    const { data: recLinkData, error: recLinkError } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: testEmail,
    });
    if (recLinkError) {
      throw new Error(`Falha ao gerar link de recuperação via admin: ${recLinkError.message}`);
    }

    const recoveryTokenHash = recLinkData.properties?.hashed_token;
    if (!recoveryTokenHash) {
      throw new Error('Falha: link de recuperação não retornou hashed_token.');
    }
    console.log('   OK: Link de recuperação e token_hash emitidos criptograficamente pelo GoTrue Cloud (0 e-mails enviados).');

    // Simula o callback consumindo o token de recuperação (contrato da rota /auth/callback?type=recovery)
    const recoveryClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: recVerifyData, error: recVerifyError } = await recoveryClient.auth.verifyOtp({
      token_hash: recoveryTokenHash,
      type: 'recovery',
    });
    if (recVerifyError || !recVerifyData.session) {
      throw new Error(`Falha ao validar token de recuperação via verifyOtp: ${recVerifyError?.message}`);
    }
    console.log('   OK: Token de recuperação validado pelo GoTrue Cloud (sessão temporária concedida).');

    // Aplica a nova senha nessa sessão temporária (fluxo da tela /auth/reset-password)
    const { error: updatePassError } = await recoveryClient.auth.updateUser({
      password: updatedPassword,
    });
    if (updatePassError) {
      throw new Error(`Falha ao definir nova senha: ${updatePassError.message}`);
    }
    console.log('   OK: Nova senha gravada com sucesso via sessão de recuperação.');

    // 9. Validação Cruzada de Senhas pós-alteração
    console.log('\n9. Testando Validação Cruzada de Senhas pós-alteração...');
    const { error: oldLoginError } = await anonClient.auth.signInWithPassword({
      email: testEmail,
      password: initialPassword,
    });
    if (!oldLoginError) {
      throw new Error('Falha de segurança: senha antiga ainda foi aceita.');
    }
    console.log(`   OK: Senha antiga rejeitada pelo Cloud GoTrue (${oldLoginError.message}).`);

    const { data: newLoginData, error: newLoginError } = await anonClient.auth.signInWithPassword({
      email: testEmail,
      password: updatedPassword,
    });
    if (newLoginError || !newLoginData.session) {
      throw new Error(`Falha no login com nova senha: ${newLoginError?.message}`);
    }
    console.log('   OK: Login com nova senha autenticado com sucesso no Cloud.');

    // 10. Teardown e Limpeza Exclusivamente via API Administrativa
    console.log('\n10. Teardown e Limpeza no Staging Cloud via Admin API...');
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) {
      throw new Error(`Falha ao remover usuário via admin.deleteUser: ${deleteError.message}`);
    }

    // Verificação de limpeza por consulta somente-leitura (SELECT)
    const finalCheck = runReadOnlySql(`SELECT count(*) FROM auth.users WHERE id = '${userId}';`);
    const remainingCount = Number(finalCheck?.rows?.[0]?.count || 0);
    if (remainingCount !== 0) {
      throw new Error('Falha na limpeza: usuário ainda consta em auth.users.');
    }
    console.log('   OK: Usuário de teste removido do staging via Admin API (0 registros restantes).');

    console.log('\n================================================================');
    console.log('  STATUS DO GATE: FLUXO COMPLETO HOMOLOGADO NO SUPABASE CLOUD! ✅');
    console.log('  Zero e-mails SMTP disparados | Zero risco de bounces | Zero SQL DML');
    console.log('================================================================');
  } catch (err) {
    console.error('\n❌ ERRO NO TESTE DE AUTH CLOUD:', err.message);
    if (userId && adminClient) {
      try {
        await adminClient.auth.admin.deleteUser(userId);
      } catch (_) {}
    }
    process.exit(1);
  }
}

runAuthGate();
