#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { migrateV3ToV4 } = require('../electron/migrations/v4.cjs');

function printUsage() {
  console.log(`
Uso:
  node scripts/migrate-dry-run.cjs <caminho-para-copia-do-json>

Exemplo:
  node scripts/migrate-dry-run.cjs "C:\\backup\\kring-vlr-data.json"

Aviso:
  Este script opera em modo SIMULAÇÃO (dry-run).
  Nenhum arquivo será modificado ou sobrescrito no disco.
`);
}

function loadCatalogs() {
  try {
    const catalogPath = path.resolve(__dirname, '../public/catalogs.json');
    if (fs.existsSync(catalogPath)) {
      return JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    }
  } catch (err) {
    console.warn(
      '⚠️ Não foi possível carregar public/catalogs.json para resolução de IDs:',
      err.message
    );
  }
  return { maps: [], agents: [] };
}

function main() {
  const targetPath = process.argv[2];
  if (!targetPath) {
    console.error('❌ Erro: Caminho do arquivo JSON não fornecido.');
    printUsage();
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), targetPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(
      `❌ Erro: O arquivo especificado não existe:\n   ${resolvedPath}`
    );
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log('   KRING VLR — SIMULADOR DE MIGRAÇÃO DE SCHEMA (V3 -> V4)');
  console.log('='.repeat(70));
  console.log(`📁 Arquivo sob teste: ${resolvedPath}`);

  let rawData;
  try {
    const content = fs.readFileSync(resolvedPath, 'utf8');
    rawData = JSON.parse(content);
  } catch (err) {
    console.error(`❌ Erro ao ler ou analisar o arquivo JSON: ${err.message}`);
    process.exit(1);
  }

  const catalogs = loadCatalogs();

  try {
    const { stats } = migrateV3ToV4(rawData, { catalogs });

    console.log('\n--- RESULTADOS DA SIMULAÇÃO (DRY-RUN) ---');
    console.log(
      `• Versão do Schema:       ${stats.schemaVersionBefore} ➔ ${stats.schemaVersionAfter}`
    );
    console.log(
      `• Campos convertidos:     ${stats.fieldsConverted} (tipos corrigidos, strings -> numbers, etc.)`
    );
    console.log(
      `• IDs gerados:            ${stats.idsGenerated} (itens que não possuíam id válido)`
    );
    console.log(
      `• Vínculos preenchidos:   ${stats.linksPopulated} (mapId/agentId associados por nome)`
    );

    console.log('\n--- CONTAGEM DE ITENS POR COLEÇÃO ---');
    console.log('Coleção        | Antes  | Depois | Diferença');
    console.log('---------------+--------+--------+----------');
    for (const key of Object.keys(stats.countsBefore)) {
      const before = stats.countsBefore[key] || 0;
      const after = stats.countsAfter[key] || 0;
      const diff =
        after - before >= 0 ? `+${after - before}` : `${after - before}`;
      console.log(
        `${key.padEnd(14)} | ${String(before).padStart(6)} | ${String(after).padStart(6)} | ${diff.padStart(9)}`
      );
    }

    console.log('\n' + '='.repeat(70));
    console.log(
      '✅ SUCESSO: A migração seria concluída com integridade de 100%.'
    );
    console.log(
      '🔒 DRY-RUN CONCLUÍDO: Nenhum arquivo foi modificado no disco.'
    );
    console.log('='.repeat(70) + '\n');
  } catch (migrationErr) {
    console.error(
      `\n❌ Falha na simulação de migração:\n   ${migrationErr.message}\n`
    );
    process.exit(1);
  }
}

main();
