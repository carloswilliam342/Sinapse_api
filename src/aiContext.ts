// Contexto do aluno enviado ao provedor de IA.
//
// Regra: o nome da criança não sai do servidor. Ele não entra no contexto e é
// trocado por um marcador nos textos livres (notas e observações em que o
// professor cita o aluno pelo nome).
//
// Limite conhecido: só o nome do próprio aluno é removido. Apelidos
// ("Pedrinho") e nomes de outras pessoas citadas nas notas continuam no texto.

export const STUDENT_PLACEHOLDER = '[aluno]';

const NAME_PARTICLES = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

// Letra sem acento → grafias aceitas, para "Luisa" nas notas casar com "Luísa" no cadastro
const ACCENT_VARIANTS: Record<string, string> = {
  a: 'aáàâãä',
  e: 'eéèêë',
  i: 'iíìîï',
  o: 'oóòôõö',
  u: 'uúùûü',
  c: 'cç',
  n: 'nñ',
};

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}

function tokenPattern(token: string): string {
  return Array.from(stripAccents(token).toLowerCase())
    .map((ch) => (ACCENT_VARIANTS[ch] ? `[${ACCENT_VARIANTS[ch]}]` : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
}

// Troca cada parte do nome (nome e sobrenomes) pelo marcador, sem diferenciar
// maiúsculas nem acentos. Prefere remover demais a deixar o nome passar: um
// aluno chamado "Clara" faz o adjetivo "clara" também virar marcador.
export function redactName(text: string, fullName: string): string {
  if (!text) return text;

  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter((part) => part.length >= 3 && !NAME_PARTICLES.has(part.toLowerCase()))
    .sort((a, b) => b.length - a.length);
  if (parts.length === 0) return text;

  // \p{L} em vez de \b: o \b do JavaScript não trata letras acentuadas como letras
  const pattern = new RegExp(`(?<!\\p{L})(?:${parts.map(tokenPattern).join('|')})(?!\\p{L})`, 'giu');

  return text
    .replace(pattern, STUDENT_PLACEHOLDER)
    // "Pedro de Oliveira" vira um marcador só, não "[aluno] de [aluno]"
    .replace(/\[aluno\](?:\s+(?:d[aeo]s?\s+|e\s+)?\[aluno\])+/g, STUDENT_PLACEHOLDER);
}

// Na resposta da IA o marcador volta a ser texto corrido: o professor lê
// "o aluno", nunca "[aluno]". Percorre textos, listas e objetos.
export function restoreStudentWording<T>(value: T): T {
  if (typeof value === 'string') {
    return value.split(STUDENT_PLACEHOLDER).join('o aluno') as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => restoreStudentWording(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, restoreStudentWording(item)]),
    ) as T;
  }
  return value;
}

// Só os campos usados no contexto; o registro do Prisma tem mais do que isso
export interface StudentForAi {
  name: string;
  needsTea: boolean;
  needsTdah: boolean;
  otherNeeds: string;
  profile: {
    performanceLevel: string;
    neurodivergence: string[];
    difficulties: string[];
    notes: string;
  } | null;
  observations: { behavior: string; participation: string; completion: string; notes: string }[];
  performanceRecords: { activityTitle: string; difficultyLevel: number; status: string; notes: string }[];
}

export function buildStudentContext(student: StudentForAi): string {
  let context = `O aluno é citado abaixo como ${STUDENT_PLACEHOLDER}; o nome real foi omitido.\n`;

  const needs: string[] = [];
  if (student.needsTea) needs.push('TEA (Transtorno do Espectro Autista)');
  if (student.needsTdah) needs.push('TDAH (Transtorno de Déficit de Atenção e Hiperatividade)');
  if (student.otherNeeds) needs.push(student.otherNeeds);
  if (needs.length > 0) {
    context += `Necessidades: ${needs.join(', ')}\n`;
  }

  const profile = student.profile;
  if (profile) {
    context += `Nível de Desempenho Atual: ${profile.performanceLevel}\n`;
    if (profile.neurodivergence.length > 0) {
      context += `Diagnósticos/Neurodivergência: ${profile.neurodivergence.join(', ')}\n`;
    }
    if (profile.difficulties.length > 0) {
      context += `Dificuldades principais: ${profile.difficulties.join(', ')}\n`;
    }
    if (profile.notes) {
      context += `Notas gerais de perfil: ${profile.notes}\n`;
    }
  }

  if (student.observations.length > 0) {
    context += `\nHistórico Recente de Observações Comportamentais nas Aulas:\n`;
    student.observations.forEach((obs) => {
      context += `- Comportamento: ${obs.behavior}, Participação: ${obs.participation}, Conclusão da atividade: ${obs.completion}. Notas do professor: ${obs.notes}\n`;
    });
  }

  if (student.performanceRecords.length > 0) {
    context += `\nDesempenho Recente em Atividades Anteriores:\n`;
    student.performanceRecords.forEach((perf) => {
      context += `- Atividade: ${perf.activityTitle}, Dificuldade (1-5): ${perf.difficultyLevel}, Status: ${perf.status}. Notas: ${perf.notes}\n`;
    });
  }

  // Passa o texto inteiro pelo filtro, para nenhum campo livre ficar de fora
  return redactName(context, student.name);
}
