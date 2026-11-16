// Respostas sintéticas para exercitar o SDK real sem chamar o Google.
const TEST_KEY = 'sinapse-synthetic-test-key';

function fixtureFor(body) {
  const properties = body.generationConfig?.responseJsonSchema?.properties ?? {};
  const common = {
    title: 'Material demonstrativo',
    instructions: 'Leia com atenção e faça a atividade.',
    teacherNotes: 'NOTA EXCLUSIVA DO PROFESSOR: dê tempo para responder.',
  };
  if (properties.exercises) return {
    ...common,
    exercises: [
      { statement: 'Quanto é 2 + 2?', options: ['3', '4'], answer: 'GABARITO EXCLUSIVO: 4' },
      { statement: 'Escreva uma palavra que começa com A.', options: [], answer: 'A resposta é livre.' },
      { statement: 'Complete: 1, 2, __.', options: [], answer: '3' },
    ],
  };
  if (properties.cards) return {
    ...common,
    cards: [
      { text: 'Molhe as mãos.', visualHint: 'Mãos sob água.' },
      { text: 'Passe sabão.', visualHint: 'Sabão nas mãos.' },
      { text: 'Enxágue as mãos.', visualHint: 'Água limpa.' },
    ],
  };
  if (properties.pairs) return {
    ...common,
    pairs: [
      { first: '2 + 2', second: '4' },
      { first: '3 + 2', second: '5' },
      { first: '3 + 3', second: '6' },
      { first: '4 + 3', second: '7' },
    ],
  };
  return {
    title: 'Contagem com números', description: 'Pratique contagens com papel e lápis.',
    steps: ['Leia os números.', 'Resolva os exercícios.'],
    visualResources: ['Papel e lápis'], adaptedFor: [], materialType: 'worksheet',
  };
}

function geminiResponse(content) {
  return Response.json({
    candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(content) }] }, finishReason: 'STOP' }],
  });
}

function installFakeGemini() {
  if (process.env.GEMINI_API_KEY !== TEST_KEY) throw new Error('Mock exige chave sintética de teste.');
  const originalFetch = globalThis.fetch;
  const calls = [];
  let handler;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).hostname !== 'generativelanguage.googleapis.com') {
      return originalFetch(input, init);
    }
    const body = await request.json();
    const call = { url: request.url, body };
    calls.push(call);
    return handler ? handler(call) : geminiResponse(fixtureFor(body));
  };
  return {
    calls,
    setHandler(next) { handler = next; },
    restore() { globalThis.fetch = originalFetch; },
  };
}

module.exports = { TEST_KEY, fixtureFor, geminiResponse, installFakeGemini };
