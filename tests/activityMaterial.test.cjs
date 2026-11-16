const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { TEST_KEY, fixtureFor, geminiResponse, installFakeGemini } = require('./helpers/fakeGemini.cjs');

// Nunca herdar DATABASE_URL do .env: a suíte só aceita banco LOCAL com nome de
// teste explícito. As migrações precisam ser aplicadas nele antes da execução.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Defina TEST_DATABASE_URL para um Postgres local descartável.');
const target = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || !/_test$/.test(target.pathname)) {
  throw new Error('TEST_DATABASE_URL deve ser local e o nome do banco deve terminar em _test.');
}
process.env.DATABASE_URL = databaseUrl;
process.env.GEMINI_API_KEY = TEST_KEY;
process.env.GEMINI_ALLOW_STUDENT_DATA = 'false';
process.env.JWT_SECRET = 'sinapse-material-integration-test-only';
const fake = installFakeGemini();
require('ts-node/register/transpile-only');
const express = require('express');
const bcrypt = require('bcrypt');
const prisma = require('../src/prisma.ts').default;
const { authenticateToken } = require('../src/middleware/auth.ts');
const prefix = 'mat-' + randomUUID();
const ownerId = prefix + '-owner';
const otherId = prefix + '-other';
const masterId = prefix + '-master';
const studentId = prefix + '-student';
const classId = prefix + '-class';
const userIds = [ownerId, otherId, masterId];
let server, base, tokens = {};

async function api(route, { method = 'GET', user = 'owner', body } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tokens[user] ? { Authorization: 'Bearer ' + tokens[user] } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

async function activity(fields = {}) {
  const result = await api('/activities', { method: 'POST', body: {
    title: 'Proposta ' + randomUUID(), subject: 'Matemática', difficulty: 2,
    description: 'Contar objetos desenhados no papel.', materialType: 'worksheet',
    steps: [{ order: 1, description: 'Conte os objetos.' }], ...fields,
  } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}

async function generate(id, options = {}) {
  return api('/ai/activities/' + id + '/material', { method: 'POST', ...options });
}

describe('material pronto de atividades', () => {
before(async () => {
  const password = await bcrypt.hash('senha-local-sintetica', 4);
  for (const [id, role] of [[ownerId, 'teacher'], [otherId, 'teacher'], [masterId, 'master']]) {
    await prisma.teacher.create({ data: {
      id, name: 'Professor de teste', login: id, email: id + '@example.test',
      password, subject: 'Matemática', role, status: 'active',
    } });
  }
  await prisma.class.create({ data: { id: classId, name: 'Turma fictícia', year: '2026', shift: 'morning', teacherId: ownerId } });
  await prisma.student.create({ data: {
    id: studentId, name: 'Luísa Ávila', classId, registrationNumber: 'ficticio', birthDate: '2017-04-12',
    needsTea: true, profile: { create: { notes: 'Luisa precisa de passos curtos.', difficulties: ['Leitura'] } },
  } });
  const app = express();
  app.use(express.json());
  app.use('/auth', require('../src/routes/authRoutes.ts').default);
  app.use('/activities', authenticateToken, require('../src/routes/activityRoutes.ts').default);
  app.use('/ai', authenticateToken, require('../src/routes/aiRoutes.ts').default);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
  for (const [label, login] of [['owner', ownerId], ['other', otherId], ['master', masterId]]) {
    const result = await api('/auth/login', { method: 'POST', user: 'none', body: { login, password: 'senha-local-sintetica' } });
    assert.equal(result.status, 200);
    tokens[label] = result.body.token;
  }
});

beforeEach(() => {
  fake.setHandler(undefined);
  process.env.GEMINI_ALLOW_STUDENT_DATA = 'false';
  process.env.GEMINI_API_KEY = TEST_KEY;
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_MODEL_MATERIAL;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  try {
    await prisma.activity.deleteMany({ where: { teacherId: { in: userIds } } });
    await prisma.studentProfile.deleteMany({ where: { studentId } });
    await prisma.student.deleteMany({ where: { id: studentId } });
    await prisma.class.deleteMany({ where: { id: classId } });
    await prisma.teacher.deleteMany({ where: { id: { in: userIds } } });
  } finally {
    fake.restore();
    await prisma.$disconnect();
  }
});

test('tipo padrão e validação de tipos preservam atividades antigas', async () => {
  const a = await activity({ materialType: undefined });
  assert.equal(a.materialType, 'none');
  assert.equal(a.material, null);
  const invalid = await api('/activities/' + a.id, { method: 'PUT', body: { materialType: 'unsupported' } });
  assert.equal(invalid.status, 400);
  assert.equal((await api('/activities/' + a.id)).body.materialType, 'none');
});

test('autenticação e isolamento também protegem geração e exclusão', async () => {
  const a = await activity();
  const beforeCalls = fake.calls.length;
  assert.equal((await generate(a.id, { user: 'none' })).status, 401);
  assert.equal((await generate(a.id, { user: 'other' })).status, 403);
  assert.equal((await api('/activities/' + a.id, { method: 'PUT', user: 'other', body: { title: 'Tentativa de alteração' } })).status, 403);
  assert.equal((await api('/activities/' + a.id + '/material', { method: 'DELETE', user: 'other' })).status, 403);
  assert.equal(fake.calls.length, beforeCalls);
  assert.equal((await generate(a.id, { user: 'master' })).status, 201);
});

test('atividade sem material é recusada antes de chamar a IA', async () => {
  const a = await activity({ materialType: 'none' });
  const calls = fake.calls.length;
  assert.equal((await generate(a.id)).status, 400);
  assert.equal(fake.calls.length, calls);
});

test('os três formatos são gerados, persistidos e incluídos na leitura e listagem', async t => {
  for (const [type, key] of [['worksheet', 'exercises'], ['sequence_cards', 'cards'], ['memory_game', 'pairs']]) {
    await t.test(type, async () => {
      const a = await activity({ materialType: type });
      const generated = await generate(a.id);
      assert.equal(generated.status, 201, JSON.stringify(generated.body));
      assert.equal(generated.body.type, type);
      assert.ok(generated.body.content[key].length > 0);
      assert.deepEqual((await api('/activities/' + a.id)).body.material, generated.body);
      assert.equal((await api('/activities')).body.find(item => item.id === a.id).material.id, generated.body.id);
    });
  }
});

test('gerar novamente substitui o material sem duplicar registros', async () => {
  const a = await activity();
  const first = await generate(a.id);
  fake.setHandler(({ body }) => geminiResponse({ ...fixtureFor(body), title: 'Versão revisada' }));
  const second = await generate(a.id);
  assert.equal(second.status, 201);
  assert.equal(second.body.id, first.body.id);
  assert.equal(second.body.content.title, 'Versão revisada');
  assert.equal(await prisma.activityMaterial.count({ where: { activityId: a.id } }), 1);
});

test('cota esgotada não apaga o material anterior nem repete a chamada', async () => {
  const a = await activity();
  const first = await generate(a.id);
  const calls = fake.calls.length;
  fake.setHandler(() => Response.json({ error: { code: 429, message: 'Cota sintética', status: 'RESOURCE_EXHAUSTED' } }, { status: 429 }));
  const limited = await generate(a.id);
  assert.equal(limited.status, 429);
  assert.match(limited.body.error, /renovação da cota/);
  assert.equal(fake.calls.length, calls + 1);
  assert.deepEqual((await api('/activities/' + a.id)).body.material, first.body);
});

test('resposta inválida, vazia e falha de rede não gravam material', async t => {
  const cases = [
    ['JSON inválido', () => Response.json({ candidates: [{ content: { parts: [{ text: '{' }] } }] }), 502],
    ['schema incompleto', () => geminiResponse({ title: 'Faltam exercícios' }), 502],
    ['resposta vazia', () => Response.json({ candidates: [] }), 502],
    ['falha de rede', () => { throw new TypeError('Falha sintética'); }, 503],
  ];
  for (const [label, handler, expected] of cases) await t.test(label, async () => {
    const a = await activity();
    fake.setHandler(handler);
    assert.equal((await generate(a.id)).status, expected);
    assert.equal(await prisma.activityMaterial.count({ where: { activityId: a.id } }), 0);
  });
});

test('ausência de chave responde 503 sem consultar o provedor', async () => {
  const a = await activity();
  process.env.GEMINI_API_KEY = '';
  const calls = fake.calls.length;
  assert.equal((await generate(a.id)).status, 503);
  assert.equal(fake.calls.length, calls);
});

test('sugestões e materiais usam os modelos padrão de suas etapas', async () => {
  const calls = fake.calls.length;
  const suggestion = await api('/ai/suggest-activity', { method: 'POST', body: { subject: 'Matemática', theme: 'Contar' } });
  assert.equal(suggestion.status, 200);
  assert.ok(fake.calls[calls].url.includes('/models/gemini-3.5-flash-lite:'));
  const a = await activity();
  assert.equal((await generate(a.id)).status, 201);
  assert.ok(fake.calls[calls + 1].url.includes('/models/gemini-3.8-flash:'));
});

test('configurar o modelo de sugestão não muda o modelo de material', async () => {
  process.env.GEMINI_MODEL = 'modelo-sugestao-sintetico';
  const calls = fake.calls.length;
  assert.equal((await api('/ai/suggest-activity', { method: 'POST', body: { subject: 'Matemática', theme: 'Contar' } })).status, 200);
  assert.ok(fake.calls[calls].url.includes('/models/modelo-sugestao-sintetico:'));
  const a = await activity();
  assert.equal((await generate(a.id)).status, 201);
  assert.ok(fake.calls[calls + 1].url.includes('/models/gemini-3.8-flash:'));
});

test('configurar o modelo de material não muda o modelo de sugestão', async () => {
  process.env.GEMINI_MODEL_MATERIAL = 'modelo-material-sintetico';
  const a = await activity();
  assert.equal((await generate(a.id)).status, 201);
  assert.ok(fake.calls.at(-1).url.includes('/models/modelo-material-sintetico:'));
  assert.equal((await api('/ai/suggest-activity', { method: 'POST', body: { subject: 'Matemática', theme: 'Contar' } })).status, 200);
  assert.ok(fake.calls.at(-1).url.includes('/models/gemini-3.5-flash-lite:'));
});

test('modelo inexistente preserva material e não troca para consumir outra cota', async () => {
  const a = await activity();
  const first = await generate(a.id);
  process.env.GEMINI_MODEL_MATERIAL = 'modelo-material-sintetico';
  const calls = fake.calls.length;
  fake.setHandler(() => Response.json({ error: { code: 404, message: 'Modelo inexistente', status: 'NOT_FOUND' } }, { status: 404 }));
  const result = await generate(a.id);
  assert.equal(result.status, 503);
  assert.match(result.body.error, /configurado para esta etapa/);
  assert.equal(fake.calls.length, calls + 1);
  assert.deepEqual((await api('/activities/' + a.id)).body.material, first.body);
});

test('cota do material esgotada não impede sugestões em outra cota', async () => {
  const a = await activity();
  const calls = fake.calls.length;
  fake.setHandler(({ url, body }) => url.includes('/models/gemini-3.8-flash:')
    ? Response.json({ error: { code: 429, message: 'Cota sintética', status: 'RESOURCE_EXHAUSTED' } }, { status: 429 })
    : geminiResponse(fixtureFor(body)));
  assert.equal((await generate(a.id)).status, 429);
  assert.equal((await api('/ai/suggest-activity', { method: 'POST', body: { subject: 'Matemática', theme: 'Contar' } })).status, 200);
  assert.equal(fake.calls.length, calls + 2);
});

test('plano gratuito bloqueia dados de aluno nas duas etapas sem chamada externa', async () => {
  const a = await activity({ studentId });
  const calls = fake.calls.length;
  assert.equal((await api('/ai/suggest-activity', { method: 'POST', body: { studentId, subject: 'Matemática', theme: 'Contar' } })).status, 403);
  assert.equal((await generate(a.id)).status, 403);
  assert.equal(fake.calls.length, calls);
});

test('contexto explicitamente habilitado remove nomes e usa a atividade salva', async () => {
  process.env.GEMINI_ALLOW_STUDENT_DATA = 'true'; // Dados fictícios, provedor interceptado.
  const a = await activity({ studentId, title: 'Luisa conta objetos', description: 'Ávila conta até cinco.' });
  assert.equal((await generate(a.id, { body: { title: 'NÃO USAR CORPO DA REQUISIÇÃO' } })).status, 201);
  const text = JSON.stringify(fake.calls.at(-1).body);
  assert.ok(text.includes('conta até cinco'));
  assert.ok(!/lu[ií]sa|[aá]vila/iu.test(text));
  assert.ok(!text.includes('NÃO USAR CORPO'));
  assert.ok(!text.includes('Histórico Recente'));
  const suggestion = await api('/ai/suggest-activity', {
    method: 'POST', body: { studentId, subject: 'Matemática de Luísa', theme: 'Luisa conta objetos.' },
  });
  assert.equal(suggestion.status, 200);
  assert.ok(!/lu[ií]sa|[aá]vila/iu.test(JSON.stringify(fake.calls.at(-1).body)));
});

test('sugestão inclui o tipo e valida a resposta do provedor', async () => {
  const suggestion = await api('/ai/suggest-activity', { method: 'POST', body: { subject: 'Matemática', theme: 'Contar' } });
  assert.equal(suggestion.status, 200);
  assert.equal(suggestion.body.materialType, 'worksheet');
  fake.setHandler(() => geminiResponse({ ...suggestion.body, materialType: 'tipo-inválido' }));
  assert.equal((await api('/ai/suggest-activity', { method: 'POST', body: { subject: 'Matemática', theme: 'Contar' } })).body.materialType, 'none');
});

test('salvar sem mudar conteúdo preserva material mesmo recriando IDs das etapas', async () => {
  const a = await activity();
  const generated = await generate(a.id);
  const saved = await api('/activities/' + a.id, { method: 'PUT', body: {
    ...a, steps: a.steps.map(({ order, description }) => ({ order, description })),
  } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.material.id, generated.body.id);
});

test('mudar proposta, etapas, tipo ou aluno invalida material antigo', async t => {
  for (const fields of [{ title: 'Novo título' }, { steps: [{ order: 1, description: 'Outro passo.' }] }, { materialType: 'memory_game' }, { studentId }]) {
    await t.test(JSON.stringify(fields), async () => {
      const a = await activity();
      assert.equal((await generate(a.id)).status, 201);
      const saved = await api('/activities/' + a.id, { method: 'PUT', body: fields });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.material, null);
    });
  }
});

test('studentId null remove vínculo e permite gerar atividade geral no plano gratuito', async () => {
  const a = await activity({ studentId });
  const saved = await api('/activities/' + a.id, { method: 'PUT', body: { studentId: null } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.studentId, null);
  assert.equal((await generate(a.id)).status, 201);
});

test('alterar a atividade durante a geração descarta resposta antiga', async () => {
  const a = await activity();
  fake.setHandler(async ({ body }) => {
    await prisma.activity.update({ where: { id: a.id }, data: { description: 'Proposta revisada durante a chamada.' } });
    return geminiResponse(fixtureFor(body));
  });
  assert.equal((await generate(a.id)).status, 409);
  assert.equal(await prisma.activityMaterial.count({ where: { activityId: a.id } }), 0);
});

test('excluir a atividade durante a geração responde 404 e não recria registros', async () => {
  const a = await activity();
  fake.setHandler(async ({ body }) => {
    await prisma.activity.delete({ where: { id: a.id } });
    return geminiResponse(fixtureFor(body));
  });
  assert.equal((await generate(a.id)).status, 404);
  assert.equal(await prisma.activityMaterial.count({ where: { activityId: a.id } }), 0);
});

test('transferir a atividade durante a geração revalida permissão antes de gravar', async () => {
  const a = await activity();
  fake.setHandler(async ({ body }) => {
    await prisma.activity.update({ where: { id: a.id }, data: { teacherId: otherId } });
    return geminiResponse(fixtureFor(body));
  });
  assert.equal((await generate(a.id)).status, 403);
  assert.equal(await prisma.activityMaterial.count({ where: { activityId: a.id } }), 0);
});

test('editar e gerar ao mesmo tempo não deixa material de uma proposta antiga', async () => {
  const a = await activity({ title: 'Proposta antes da edição' });
  fake.setHandler(({ body }) => {
    const prompt = JSON.stringify(body.contents);
    return geminiResponse({ ...fixtureFor(body), title: prompt.includes('Proposta depois da edição') ? 'Material atualizado' : 'Material antigo' });
  });
  const [generated, edited] = await Promise.all([
    generate(a.id),
    api('/activities/' + a.id, { method: 'PUT', body: { title: 'Proposta depois da edição' } }),
  ]);
  assert.ok([201, 409].includes(generated.status));
  assert.equal(edited.status, 200);
  const current = (await api('/activities/' + a.id)).body;
  assert.equal(current.title, 'Proposta depois da edição');
  assert.ok(current.material === null || current.material.content.title === 'Material atualizado');
});

test('mudança do perfil durante a geração impede salvar material do contexto anterior', async () => {
  process.env.GEMINI_ALLOW_STUDENT_DATA = 'true';
  const a = await activity({ studentId });
  fake.setHandler(async ({ body }) => {
    await prisma.studentProfile.update({ where: { studentId }, data: { notes: 'Perfil atualizado durante a geração.' } });
    return geminiResponse(fixtureFor(body));
  });
  assert.equal((await generate(a.id)).status, 409);
  assert.equal(await prisma.activityMaterial.count({ where: { activityId: a.id } }), 0);
});

test('excluir material preserva atividade; excluir atividade remove material em cascata', async () => {
  const a = await activity();
  await generate(a.id);
  assert.equal((await api('/activities/' + a.id + '/material', { method: 'DELETE' })).status, 200);
  assert.equal((await api('/activities/' + a.id)).body.material, null);
  await generate(a.id);
  assert.equal((await api('/activities/' + a.id, { method: 'DELETE' })).status, 200);
  assert.equal(await prisma.activityMaterial.count({ where: { activityId: a.id } }), 0);
});
});
