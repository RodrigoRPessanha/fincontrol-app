import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import pg from 'pg';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Obter configuração de conexão segura exclusivamente via variáveis de ambiente
function getDatabaseConfig() {
  const connectionUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (connectionUrl) {
    return {
      mode: 'direct',
      connectionString: connectionUrl,
      ssl: {
        // Validação estrita do certificado TLS na conexão direta
        rejectUnauthorized: true,
        ca: process.env.SUPABASE_DB_SSL_CA ? fs.readFileSync(process.env.SUPABASE_DB_SSL_CA, 'utf-8') : undefined
      }
    };
  }

  const password = process.env.SUPABASE_DB_PASSWORD;
  if (password) {
    const host = process.env.SUPABASE_DB_HOST || 'db.iwesoczokkycjovyknnz.supabase.co';
    const port = parseInt(process.env.SUPABASE_DB_PORT || '5432', 10);
    const user = process.env.SUPABASE_DB_USER || 'postgres';
    const database = process.env.SUPABASE_DB_NAME || 'postgres';

    return {
      mode: 'direct',
      host,
      port,
      user,
      database,
      password,
      ssl: {
        // Validação estrita do certificado TLS na conexão direta
        rejectUnauthorized: true,
        ca: process.env.SUPABASE_DB_SSL_CA ? fs.readFileSync(process.env.SUPABASE_DB_SSL_CA, 'utf-8') : undefined
      },
      connectionTimeoutMillis: 15000
    };
  }

  // Fallback seguro: se a senha direta não estiver exportada no shell,
  // utiliza a sessão autenticada da Supabase CLI vinculada ao projeto Cloud
  return {
    mode: 'cli-linked'
  };
}

// Extrair o número planejado de testes do arquivo SQL (SELECT plan(N);)
function extractPlannedCount(sql) {
  const planMatch = sql.match(/SELECT\s+plan\((\d+)\);/i);
  return planMatch ? parseInt(planMatch[1], 10) : 0;
}

// Execução via pg.Client direto com validação estrita de TLS e contagem real
async function runTestWithPgClient(filePath, dbConfig, declaredPlan) {
  const fileName = path.basename(filePath);
  const sql = fs.readFileSync(filePath, 'utf-8');
  const client = new Client(dbConfig);
  const failures = [];

  let ran = 0;
  let planned = declaredPlan;
  let failed = 0;
  let finishDiags = [];

  try {
    await client.connect();
    const results = await client.query(sql);
    const resultSets = Array.isArray(results) ? results : [results];

    for (const res of resultSets) {
      if (!res.rows || res.rows.length === 0) continue;
      for (const row of res.rows) {
        if (row.ran !== undefined && row.planned !== undefined) {
          ran = Number(row.ran);
          planned = Number(row.planned);
          failed = Number(row.failed || 0);
          if (Array.isArray(row.finish_diagnostics)) {
            finishDiags = row.finish_diagnostics;
          }
        }
        const val = Object.values(row)[0];
        if (typeof val === 'string') {
          if (val.startsWith('not ok ')) {
            failures.push(val);
          }
          if (val.includes('Looks like you failed') || val.includes('Looks like you planned')) {
            failures.push(val);
          }
        }
      }
    }

    // 1. Falhar diante de qualquer diagnóstico retornado por finish()
    for (const diag of finishDiags) {
      if (!failures.includes(diag)) failures.push(diag);
    }

    // 2. Validar contagem real de asserções executadas
    if (ran === 0 && planned > 0) {
      failures.push(`Nenhuma asserção foi executada no banco (planejado: ${planned}).`);
    }

    // 3. Falhar se a contagem real divergir do plano declarado
    if (ran !== planned) {
      failures.push(`Divergência de plano: planejado ${planned} testes, mas executou ${ran} asserções.`);
    }

    // 4. Falhar se houver asserções reprovadas
    if (failed > 0) {
      failures.push(`${failed} asserção(ões) reprovada(s) no pgTAP.`);
    }

    const passed = Math.max(0, ran - failed);
    const success = failures.length === 0 && ran > 0 && ran === planned && failed === 0;

    return {
      fileName,
      success,
      planned,
      passed,
      failed: failed > 0 ? failed : failures.length,
      failures
    };
  } catch (err) {
    return {
      fileName,
      success: false,
      planned,
      passed: 0,
      failed: 1,
      failures: [`Erro SQL na execução: ${err.message}`]
    };
  } finally {
    try {
      await client.end();
    } catch {
      // Ignora erro de encerramento
    }
  }
}

// Execução via Supabase Cloud CLI vinculada (--linked) com validação estrita de diagnósticos e contagem real
function runTestWithCliLinked(filePath, declaredPlan) {
  const fileName = path.basename(filePath);
  const isWindows = process.platform === 'win32';
  const cmd = isWindows
    ? `cmd /c npx supabase db query --linked --file "${filePath}"`
    : `npx supabase db query --linked --file "${filePath}"`;

  try {
    const rawOutput = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000
    });

    const failures = [];

    // 1. Extrair bloco JSON com rows de resultado
    const jsonMatch = rawOutput.match(/\{[\s\S]*"rows"[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        fileName,
        success: false,
        planned: declaredPlan,
        passed: 0,
        failed: 1,
        failures: [`Falha ao interpretar resposta do banco: ${rawOutput.trim()}`]
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      return {
        fileName,
        success: false,
        planned: declaredPlan,
        passed: 0,
        failed: 1,
        failures: [`Erro de parsing JSON na resposta remota: ${parseErr.message}`]
      };
    }

    if (parsed.error || parsed._tag === 'Error') {
      return {
        fileName,
        success: false,
        planned: declaredPlan,
        passed: 0,
        failed: 1,
        failures: [parsed.error?.message || JSON.stringify(parsed.error)]
      };
    }

    const summaryRow = parsed.rows && parsed.rows.find(r => r.ran !== undefined && r.planned !== undefined);
    if (!summaryRow) {
      return {
        fileName,
        success: false,
        planned: declaredPlan,
        passed: 0,
        failed: 1,
        failures: ['O arquivo de teste não retornou o resumo de execução (ran, planned, failed, finish_diagnostics).']
      };
    }

    const ran = Number(summaryRow.ran);
    const planned = Number(summaryRow.planned);
    const failed = Number(summaryRow.failed || 0);
    const finishDiags = Array.isArray(summaryRow.finish_diagnostics) ? summaryRow.finish_diagnostics : [];

    // 2. Falhar diante de QUALQUER diagnóstico de finish()
    if (finishDiags.length > 0) {
      for (const diag of finishDiags) {
        failures.push(diag);
      }
    }

    // 3. Falhar se houver texto de diagnóstico no corpo bruto da resposta
    const textDiagMatches = rawOutput.match(/# Looks like you (failed|planned)[^"'\r\n]*/g);
    if (textDiagMatches) {
      for (const td of textDiagMatches) {
        const cleanDiag = td.trim();
        if (!failures.includes(cleanDiag)) failures.push(cleanDiag);
      }
    }

    // 4. Validar contagem real de asserções executadas
    if (ran === 0 && planned > 0) {
      failures.push(`Nenhuma asserção foi executada no banco (planejado: ${planned}).`);
    }

    // 5. Falhar diante de divergência entre a contagem real e o plano declarado
    if (ran !== planned) {
      failures.push(`Divergência de plano: planejado ${planned} testes, mas o banco executou ${ran} asserções.`);
    }

    // 6. Falhar se houver asserções reprovadas
    if (failed > 0) {
      failures.push(`${failed} asserção(ões) reprovada(s) no pgTAP.`);
    }

    // 7. Verificar se há registros explícitos de "not ok " no output
    const notOkMatches = rawOutput.match(/not ok \d+[^\r\n]*/g);
    if (notOkMatches) {
      for (const n of notOkMatches) {
        if (!failures.includes(n)) failures.push(n);
      }
    }

    const passed = Math.max(0, ran - failed);
    const success = failures.length === 0 && ran > 0 && ran === planned && failed === 0;

    return {
      fileName,
      success,
      planned,
      passed,
      failed: failed > 0 ? failed : failures.length,
      failures
    };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    const stdout = err.stdout ? err.stdout.toString() : '';
    const errorDetails = (stderr || stdout || err.message).trim();
    return {
      fileName,
      success: false,
      planned: declaredPlan,
      passed: 0,
      failed: 1,
      failures: [`Falha na execução remota: ${errorDetails}`]
    };
  }
}

async function runTestFile(filePath, dbConfig) {
  const sql = fs.readFileSync(filePath, 'utf-8');
  const planned = extractPlannedCount(sql);

  if (dbConfig.mode === 'direct') {
    return runTestWithPgClient(filePath, dbConfig, planned);
  } else {
    return runTestWithCliLinked(filePath, planned);
  }
}

async function main() {
  console.log('\x1b[36m%s\x1b[0m', '=== FinControl Cloud Database Test Runner (pgTAP) ===');
  console.log('Conectando ao banco de dados no Supabase Cloud (fincontrol-staging)...');

  const dbConfig = getDatabaseConfig();
  if (dbConfig.mode === 'direct') {
    console.log('Modo de conexão: Direto via PostgreSQL Client (TLS rejectUnauthorized: true)');
  } else {
    console.log('Modo de conexão: Gerenciado via Supabase Cloud CLI vinculada (--linked)');
  }

  const testsDir = path.resolve(__dirname, '../supabase/tests/database');
  if (!fs.existsSync(testsDir)) {
    console.error(`Diretório de testes não encontrado: ${testsDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(testsDir)
    .filter(f => f.endsWith('.test.sql'))
    .sort();

  if (files.length === 0) {
    console.error('Nenhum arquivo de teste .test.sql encontrado.');
    process.exit(1);
  }

  console.log(`Encontrados ${files.length} arquivos de teste em ${testsDir}\n`);

  let totalPlanned = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let anyError = false;

  for (const file of files) {
    const fullPath = path.join(testsDir, file);
    process.stdout.write(`Executando ${file}... `);
    const start = Date.now();
    const result = await runTestFile(fullPath, dbConfig);
    const duration = ((Date.now() - start) / 1000).toFixed(2);

    totalPlanned += result.planned;
    totalPassed += result.passed;
    totalFailed += result.failed;

    if (result.success) {
      console.log(`\x1b[32mPASS\x1b[0m (${result.passed}/${result.planned} asserções reais comprovadas) [${duration}s]`);
    } else {
      console.log(`\x1b[31mFAIL\x1b[0m (${result.passed}/${result.planned}) [${duration}s]`);
      anyError = true;
      for (const fail of result.failures) {
        console.error(`  \x1b[31m✖ ${fail}\x1b[0m`);
      }
    }
  }

  console.log('\n------------------------------------------------------------');
  if (anyError || totalFailed > 0) {
    console.log(`\x1b[31mResultado Final: FALHA\x1b[0m (${totalPassed} aprovadas, ${totalFailed} reprovadas de ${totalPlanned} planejadas)`);
    process.exit(1);
  } else {
    console.log(`\x1b[32mResultado Final: SUCESSO TOTAL\x1b[0m (${totalPassed} asserções reais aprovadas em ${files.length} arquivos)`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error('\x1b[31mErro fatal no runner de testes:\x1b[0m', err.message);
  process.exit(1);
});
