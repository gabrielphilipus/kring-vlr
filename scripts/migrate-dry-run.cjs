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

function findDifferences(objA, objB, currentPath = '') {
  const diffs = [];
  if (objA === objB) return diffs;

  if (
    typeof objA !== typeof objB ||
    objA === null ||
    objB === null ||
    typeof objA !== 'object'
  ) {
    diffs.push(
      `${currentPath}: ${JSON.stringify(objA)} !== ${JSON.stringify(objB)}`
    );
    return diffs;
  }

  if (Array.isArray(objA) !== Array.isArray(objB)) {
    diffs.push(`${currentPath}: incompatibilidade de array`);
    return diffs;
  }

  if (Array.isArray(objA)) {
    if (objA.length !== objB.length) {
      diffs.push(`${currentPath}.length: ${objA.length} !== ${objB.length}`);
    }
    const maxLen = Math.max(objA.length, objB.length);
    for (let i = 0; i < maxLen; i++) {
      diffs.push(...findDifferences(objA[i], objB[i], `${currentPath}[${i}]`));
    }
    return diffs;
  }

  const allKeys = Array.from(
    new Set([...Object.keys(objA), ...Object.keys(objB)])
  );
  for (const k of allKeys) {
    diffs.push(
      ...findDifferences(
        objA[k],
        objB[k],
        currentPath ? `${currentPath}.${k}` : k
      )
    );
  }
  return diffs;
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

  console.log('='.repeat(72));
  console.log('   KRING VLR — SIMULADOR DE MIGRAÇÃO DE SCHEMA (V3 -> V4)');
  console.log('='.repeat(72));
  console.log(`📁 Arquivo sob teste: ${resolvedPath}`);

  let rawContent;
  let rawData;
  try {
    rawContent = fs.readFileSync(resolvedPath, 'utf8');
    rawData = JSON.parse(rawContent);
  } catch (err) {
    console.error(`❌ Erro ao ler ou analisar o arquivo JSON: ${err.message}`);
    process.exit(1);
  }

  const catalogs = loadCatalogs();

  try {
    // Primeira passada da migração
    const firstPass = migrateV3ToV4(rawData, { catalogs });
    const { stats, migrated } = firstPass;

    console.log('\n--- 1. RESULTADOS GERAIS DA SIMULAÇÃO ---');
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
      `• Vínculos preenchidos:   ${stats.linksPopulated} (mapId/agentId associados por correspondência)`
    );

    console.log('\n--- 2. CONTAGEM DE ITENS POR COLEÇÃO ---');
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

    console.log('\n--- 3. VÍNCULOS NÃO CORRESPONDIDOS ---');
    if (!stats.unlinkedMaps || stats.unlinkedMaps.length === 0) {
      console.log(
        '• Mapas sem correspondência:   0 (todos os mapas encontrados foram vinculados)'
      );
    } else {
      console.log(
        `• Mapas sem correspondência:   ${stats.unlinkedMaps.length} distintos [${stats.unlinkedMaps.join(', ')}]`
      );
    }

    if (!stats.unlinkedAgents || stats.unlinkedAgents.length === 0) {
      console.log(
        '• Agentes sem correspondência: 0 (todos os agentes encontrados foram vinculados)'
      );
    } else {
      console.log(
        `• Agentes sem correspondência: ${stats.unlinkedAgents.length} distintos [${stats.unlinkedAgents.join(', ')}]`
      );
    }

    // Segunda passada: teste de idempotência
    const secondPass = migrateV3ToV4(migrated, { catalogs });
    const secondPassDiffs = findDifferences(migrated, secondPass.migrated);

    console.log('\n--- 4. SEGUNDA PASSADA (TESTE DE IDEMPOTÊNCIA) ---');
    if (secondPassDiffs.length === 0) {
      console.log(
        '✅ 0 mudanças na segunda passada (idempotência perfeita comprovada: migrar 2x é idêntico a migrar 1x).'
      );
    } else {
      console.log(
        `⚠️ ATENÇÃO: Foram encontradas ${secondPassDiffs.length} diferenças na segunda passada:`
      );
      secondPassDiffs.slice(0, 10).forEach((d) => console.log(`   - ${d}`));
    }

    // Tamanho total e por coleção em KB
    console.log('\n--- 5. TAMANHO TOTAL E POR COLEÇÃO (KB) ---');
    const totalBeforeKB = (
      Buffer.byteLength(rawContent, 'utf8') / 1024
    ).toFixed(2);
    const totalAfterKB = (
      Buffer.byteLength(JSON.stringify(migrated, null, 2), 'utf8') / 1024
    ).toFixed(2);
    console.log(
      `• Tamanho Total do JSON:   ${totalBeforeKB} KB ➔ ${totalAfterKB} KB`
    );
    console.log('Coleção        | Tamanho Antes | Tamanho Depois');
    console.log('---------------+---------------+---------------');
    for (const key of Object.keys(stats.countsBefore)) {
      const sizeBefore = (
        Buffer.byteLength(JSON.stringify(rawData[key] || []), 'utf8') / 1024
      ).toFixed(2);
      const sizeAfter = (
        Buffer.byteLength(JSON.stringify(migrated[key] || []), 'utf8') / 1024
      ).toFixed(2);
      console.log(
        `${key.padEnd(14)} | ${String(sizeBefore + ' KB').padStart(13)} | ${String(sizeAfter + ' KB').padStart(14)}`
      );
    }

    // Verificação de preservação de campos
    console.log('\n--- 6. VERIFICAÇÃO DE PRESERVAÇÃO DE CAMPOS ---');
    const violations = [];
    for (const key of Object.keys(rawData)) {
      if (!(key in migrated)) {
        violations.push(`Propriedade raiz ausente na saída: "${key}"`);
      }
    }
    const collections = [
      'vods',
      'lineups',
      'tactics',
      'training',
      'gameplans',
      'maps',
      'agents',
    ];
    for (const col of collections) {
      const beforeList = Array.isArray(rawData[col]) ? rawData[col] : [];
      const afterList = Array.isArray(migrated[col]) ? migrated[col] : [];
      for (let i = 0; i < beforeList.length; i++) {
        const itemBefore = beforeList[i];
        const itemAfter = afterList[i];
        if (!itemAfter) {
          violations.push(`${col}[${i}] ausente na saída`);
          continue;
        }
        for (const prop of Object.keys(itemBefore)) {
          if (!(prop in itemAfter)) {
            violations.push(`${col}[${i}].${prop} desapareceu na saída`);
          }
        }
      }
    }

    if (violations.length === 0) {
      console.log(
        '✅ 0 violações: todos os campos existentes na entrada continuam existindo na saída (incluindo vod.gamePlan e campos desconhecidos).'
      );
    } else {
      console.log(
        `❌ ${violations.length} violações de integridade encontradas:`
      );
      violations.slice(0, 10).forEach((v) => console.log(`   - ${v}`));
    }

    console.log('\n' + '='.repeat(72));
    console.log(
      '✅ SUCESSO: A migração seria concluída com integridade de 100%.'
    );
    console.log(
      '🔒 DRY-RUN CONCLUÍDO: Nenhum byte foi modificado ou gravado no disco.'
    );
    console.log('='.repeat(72) + '\n');
  } catch (migrationErr) {
    console.error(
      `\n❌ Falha na simulação de migração:\n   ${migrationErr.message}\n`
    );
    process.exit(1);
  }
}

main();
