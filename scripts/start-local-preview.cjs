// Inicia a demonstração local com dados fictícios. Não usa o banco do .env.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const front = path.resolve(root, '../sinapse-front');
const runtime = path.join(root, '.local-preview');
const databaseUrl = 'postgresql://postgres:sinapse-local-preview@127.0.0.1:5547/sinapse_preview';
const container = 'sinapse-local-preview';

function run(args, env = process.env) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error('Falha ao executar ' + args[0]);
}
function docker(args) {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Docker: ' + result.stderr.trim());
  return result.stdout.trim();
}
async function available(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}
async function ready(url) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Servidor não respondeu: ' + url + '. Consulte .local-preview/*.log');
}
function launch(name, args, env, cwd) {
  const out = fs.openSync(path.join(runtime, name + '.log'), 'a');
  const child = spawn(process.execPath, args, { cwd, env, detached: true, windowsHide: true, stdio: ['ignore', out, out] });
  child.unref();
  fs.closeSync(out);
  return child.pid;
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use o Node 24 do sistema diretamente para confiar nos certificados do Windows.');
  await Promise.all([available(3000), available(3108)]);
  fs.mkdirSync(runtime, { recursive: true });
  const exists = docker(['ps', '-a', '--filter', 'name=^/' + container + '$', '--format', '{{.Names}}']);
  if (exists) {
    docker(['start', container]);
  } else {
    docker(['run', '--detach', '--name', container, '--publish', '127.0.0.1:5547:5432',
      '--env', 'POSTGRES_PASSWORD=sinapse-local-preview', '--env', 'POSTGRES_DB=sinapse_preview',
      '--mount', 'type=volume,source=sinapse-preview-pgdata,target=/var/lib/postgresql/data', 'postgres:16-alpine']);
  }
  let dbReady = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const probe = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8', windowsHide: true });
    if (probe.status === 0) { dbReady = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!dbReady) throw new Error('Banco de demonstração não ficou pronto.');
  require('dotenv').config({ path: path.join(root, '.env') });
  const env = { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'development', GEMINI_ALLOW_STUDENT_DATA: 'false',
    GEMINI_MODEL: 'gemini-3.5-flash-lite', GEMINI_MODEL_MATERIAL: 'gemini-3.8-flash', RESEND_API_KEY: '', TRUST_PROXY_HOPS: '0' };
  run(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], env);
  // Compilar antes de subir a API evita DLL do Prisma bloqueada no Windows.
  run(['node_modules/typescript/bin/tsc'], env);
  process.env.DATABASE_URL = databaseUrl;
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  let seedPassword;
  try {
    const count = await prisma.teacher.count();
    if (count === 0) {
      seedPassword = crypto.randomBytes(9).toString('base64url');
      run(['-r', 'ts-node/register', 'prisma/seed.ts'], { ...env, SEED_PASSWORD: seedPassword });
    }
    for (const [id, title, materialType, description] of [
      ['preview-worksheet', 'Demonstração: contagem de 1 a 5', 'worksheet', 'Praticar a contagem de 1 a 5 com enunciados curtos e desenhos feitos pelo aluno, apenas papel e lápis.'],
      ['preview-memory', 'Demonstração: somas e resultados', 'memory_game', 'Combinar somas simples com seus resultados, usando números de 1 a 5.'],
      ['preview-sequence', 'Demonstração: sequência de lavar as mãos', 'sequence_cards', 'Ordenar cartões de texto com as etapas de lavar as mãos.'],
    ]) {
      await prisma.activity.upsert({ where: { id }, update: {}, create: {
        id, title, materialType, description, teacherId: 'admin', subject: 'Matemática', difficulty: 1,
        steps: { create: [{ order: 1, description: 'Leia as instruções e faça a atividade com papel e lápis.' }] },
      } });
    }
  } finally { await prisma.$disconnect(); }
  const apiPid = launch('api', ['--use-system-ca', 'dist/server.js'], { ...env, PORT: '3108', FRONTEND_URL: 'http://localhost:3000', JWT_SECRET: crypto.randomBytes(32).toString('hex') }, root);
  await ready('http://127.0.0.1:3108/api/health');
  const frontPid = launch('front', [path.join(front, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '3000', '--strictPort'], { ...process.env, VITE_API_URL: 'http://localhost:3108/api' }, front);
  await ready('http://127.0.0.1:3000');
  fs.writeFileSync(path.join(runtime, 'state.json'), JSON.stringify({ apiPid, frontPid, apiUrl: 'http://localhost:3108/api', frontUrl: 'http://localhost:3000', container }, null, 2));
  console.log(JSON.stringify({ ready: true, url: 'http://localhost:3000', apiPid, frontPid, login: 'admin', ...(seedPassword ? { temporaryPassword: seedPassword } : { password: 'Use a senha já definida neste banco local.' }) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
