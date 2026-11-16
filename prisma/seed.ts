import 'dotenv/config';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Este script APAGA todas as tabelas antes de inserir os dados de exemplo.
// Em banco local roda direto; em banco remoto só roda com confirmação explícita.
function assertSafeToSeed() {
  let host = '';
  try {
    host = new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    // DATABASE_URL ausente ou ilegível: tratado abaixo como "não local"
  }

  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Seed bloqueado: NODE_ENV=production. Este script apaga todos os dados.');
    process.exit(1);
  }

  const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
  if (!isLocal && process.env.SEED_CONFIRM !== host) {
    console.error('❌ Seed bloqueado: o DATABASE_URL aponta para um banco que não é local.');
    console.error(`   Host: ${host || '(não identificado)'}`);
    console.error('   Este script APAGA TODAS AS TABELAS desse banco antes de inserir os dados de exemplo.');
    console.error('   Se é isso mesmo que você quer, rode de novo com SEED_CONFIRM igual ao host acima.');
    process.exit(1);
  }
}

async function main() {
  assertSafeToSeed();
  console.log('🌱 Iniciando seed...');

  // Senha das contas de exemplo: vem de SEED_PASSWORD ou é gerada nesta execução.
  // Nunca fica uma senha fixa conhecida no código.
  const seedPassword = process.env.SEED_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const seedPasswordHash = await bcrypt.hash(seedPassword, 10);

  // Limpar dados existentes (ordem importa por causa das FKs)
  await prisma.performanceRecord.deleteMany();
  await prisma.lessonObservation.deleteMany();
  await prisma.routineSnapshot.deleteMany();
  await prisma.routineItem.deleteMany();
  await prisma.activityStep.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.studentProfile.deleteMany();
  await prisma.student.deleteMany();
  await prisma.class.deleteMany();
  await prisma.passwordReset.deleteMany();
  await prisma.systemLog.deleteMany();
  await prisma.teacher.deleteMany();

  console.log('📋 Dados antigos removidos.');

  // Usuário Master (Administrador do Sistema)
  await prisma.teacher.create({
    data: {
      id: 'admin',
      name: 'Administrador do Sistema',
      email: 'admin@escola.edu.br',
      login: 'admin',
      password: seedPasswordHash,
      status: 'active',
      subject: 'Administração',
      role: 'master',
    },
  });

  // Teachers
  const t1 = await prisma.teacher.create({
    data: {
      id: 't1', name: 'Maria Silva', email: 'maria.silva@escola.edu.br',
      login: 'maria.silva', password: seedPasswordHash, status: 'active',
      subject: 'Educação Especial', role: 'teacher',
    },
  });
  const t2 = await prisma.teacher.create({
    data: {
      id: 't2', name: 'João Santos', email: 'joao.santos@escola.edu.br',
      login: 'joao.santos', password: seedPasswordHash, status: 'active',
      subject: 'Pedagogia', role: 'teacher',
    },
  });
  await prisma.teacher.create({
    data: {
      id: 't3', name: 'Ana Lima', email: 'ana.lima@escola.edu.br',
      login: 'ana.lima', password: seedPasswordHash, status: 'inactive',
      subject: 'Psicopedagogia', role: 'teacher',
    },
  });
  console.log('👩‍🏫 Professores criados.');

  // Classes
  await prisma.class.createMany({
    data: [
      { id: 'c1', name: '1º Ano A', year: '1º Ano', shift: 'morning', teacherId: 't1' },
      { id: 'c2', name: '2º Ano B', year: '2º Ano', shift: 'afternoon', teacherId: 't2' },
      { id: 'c3', name: '3º Ano A', year: '3º Ano', shift: 'morning', teacherId: 't1' },
    ],
  });
  console.log('🏫 Turmas criadas.');

  // Students
  await prisma.student.createMany({
    data: [
      { id: 's1', name: 'Pedro Oliveira', classId: 'c1', registrationNumber: '20240001', birthDate: '2017-04-12', needsTea: true, needsTdah: false, otherNeeds: '', needsObservations: 'Necessita de rotina visual estruturada. Responde bem a pictogramas e antecipações.' },
      { id: 's2', name: 'Luísa Ferreira', classId: 'c1', registrationNumber: '20240002', birthDate: '2017-09-23', needsTea: false, needsTdah: true, otherNeeds: '', needsObservations: 'Dificuldade em manter foco por longos períodos. Beneficia-se de atividades curtas e dinâmicas.' },
      { id: 's3', name: 'Carlos Mendes', classId: 'c1', registrationNumber: '20240003', birthDate: '2017-06-05', needsTea: false, needsTdah: false, otherNeeds: '', needsObservations: '' },
      { id: 's4', name: 'Sofia Costa', classId: 'c1', registrationNumber: '20240004', birthDate: '2017-01-30', needsTea: true, needsTdah: true, otherNeeds: '', needsObservations: 'Duplo diagnóstico. Plano de atendimento individualizado em revisão.' },
      { id: 's5', name: 'Mateus Rodrigues', classId: 'c1', registrationNumber: '20240005', birthDate: '2017-11-08', needsTea: false, needsTdah: true, otherNeeds: 'Dislexia', needsObservations: 'Dificuldade com leitura e escrita. Usa recursos de audiodescrição.' },
      { id: 's6', name: 'Ana Paula Gomes', classId: 'c2', registrationNumber: '20240006', birthDate: '2016-07-14', needsTea: false, needsTdah: false, otherNeeds: '', needsObservations: '' },
      { id: 's7', name: 'Bruno Costa', classId: 'c2', registrationNumber: '20240007', birthDate: '2016-03-22', needsTea: true, needsTdah: false, otherNeeds: '', needsObservations: 'Comunicação predominantemente não verbal. Utiliza CAA (Comunicação Alternativa e Aumentativa).' },
      { id: 's8', name: 'Carla Santos', classId: 'c2', registrationNumber: '20240008', birthDate: '2016-10-17', needsTea: false, needsTdah: false, otherNeeds: '', needsObservations: '' },
      { id: 's9', name: 'Felipe Alves', classId: 'c3', registrationNumber: '20240009', birthDate: '2015-05-28', needsTea: true, needsTdah: false, otherNeeds: 'Deficiência Intelectual Leve', needsObservations: 'Necessita de adaptações curriculares significativas.' },
      { id: 's10', name: 'Juliana Rocha', classId: 'c3', registrationNumber: '20240010', birthDate: '2015-08-03', needsTea: false, needsTdah: true, otherNeeds: '', needsObservations: 'Beneficia-se de pausas frequentes e ambiente com menos estímulos.' },
    ],
  });
  console.log('🧒 Alunos criados.');

  // Student Profiles
  await prisma.studentProfile.createMany({
    data: [
      { studentId: 's1', neurodivergence: ['TEA (Nível 1)'], difficulties: ['Interação Social', 'Flexibilidade Cognitiva', 'Comunicação Verbal'], performanceLevel: 'intermediate', notes: 'Tem boa memória visual. Aprende melhor com sequências ilustradas. Progresso notável em Matemática com uso de materiais concretos.' },
      { studentId: 's2', neurodivergence: ['TDAH (Predominantemente Desatento)'], difficulties: ['Atenção Sustentada', 'Organização', 'Planejamento'], performanceLevel: 'intermediate', notes: 'Responde bem a estratégias de gamificação. Timer visual auxilia na gestão do tempo.' },
      { studentId: 's4', neurodivergence: ['TEA (Nível 2)', 'TDAH (Combinado)'], difficulties: ['Comunicação', 'Interação Social', 'Atenção', 'Regulação Emocional'], performanceLevel: 'beginner', notes: 'Necessita de suporte intensivo. Em processo de avaliação para PAI (Plano de Atendimento Individual).' },
      { studentId: 's5', neurodivergence: ['TDAH (Hiperativo-Impulsivo)', 'Dislexia'], difficulties: ['Leitura', 'Escrita', 'Atenção', 'Controle de Impulsos'], performanceLevel: 'beginner', notes: 'Utiliza texto-para-fala e fala-para-texto. Mostra grande criatividade oral.' },
      { studentId: 's7', neurodivergence: ['TEA (Nível 2)'], difficulties: ['Comunicação Verbal', 'Interação Social', 'Tolerância à Frustração'], performanceLevel: 'intermediate', notes: 'Usa prancha de CAA com 48 símbolos. Avançou significativamente na comunicação nos últimos 3 meses.' },
      { studentId: 's9', neurodivergence: ['TEA (Nível 1)', 'Deficiência Intelectual Leve'], difficulties: ['Abstração', 'Leitura', 'Matemática', 'Interação Social'], performanceLevel: 'beginner', notes: 'Trabalha com currículo funcional. Foco em habilidades de vida diária.' },
      { studentId: 's10', neurodivergence: ['TDAH (Combinado)'], difficulties: ['Atenção', 'Hiperatividade', 'Organização', 'Conclusão de Tarefas'], performanceLevel: 'intermediate', notes: 'Usa lista de verificação visual. Estratégia de recompensas tem sido eficaz.' },
    ],
  });
  console.log('📊 Perfis de alunos criados.');

  // Activities (com steps)
  const activitiesData = [
    {
      id: 'a1', title: 'Leitura com Pictogramas', subject: 'Português',
      description: 'Atividade de leitura utilizando pictogramas do sistema PECS para suporte visual à compreensão textual.',
      visualResources: ['Cartões PECS', 'Prancha de comunicação', 'Texto impresso com imagens'],
      difficulty: 2, adaptedFor: ['TEA'],
      steps: [
        { order: 1, description: 'Apresentar os pictogramas relacionados ao texto' },
        { order: 2, description: 'Ler o texto em voz alta apontando para os pictogramas' },
        { order: 3, description: 'Solicitar que o aluno aponte o pictograma quando ouvir a palavra' },
        { order: 4, description: 'Responder perguntas simples usando os pictogramas como apoio' },
      ],
    },
    {
      id: 'a2', title: 'Organização da Mochila com Checklist', subject: 'Habilidades de Vida',
      description: 'Desenvolvimento de autonomia e organização utilizando checklist visual ilustrado.',
      visualResources: ['Checklist ilustrado', 'Quadro de organização', 'Fichas de itens'],
      difficulty: 1, adaptedFor: ['TEA', 'TDAH'],
      steps: [
        { order: 1, description: 'Apresentar o checklist visual com itens ilustrados' },
        { order: 2, description: 'Nomear cada item e sua função' },
        { order: 3, description: 'Aluno segue o checklist item por item' },
        { order: 4, description: 'Registrar na folha de acompanhamento os itens concluídos' },
      ],
    },
    {
      id: 'a3', title: 'Matemática com Blocos Lógicos', subject: 'Matemática',
      description: 'Operações matemáticas básicas utilizando blocos lógicos para manipulação concreta.',
      visualResources: ['Blocos lógicos', 'Ficha de registro', 'Tabela numérica visual'],
      difficulty: 3, adaptedFor: ['TDAH', 'TEA'],
      steps: [
        { order: 1, description: 'Apresentar os blocos e explorar formas e cores' },
        { order: 2, description: 'Propor agrupamentos por atributo (cor, forma, tamanho)' },
        { order: 3, description: 'Realizar contagens e operações simples com os blocos' },
        { order: 4, description: 'Registrar resultado em ficha de atividade' },
      ],
    },
    {
      id: 'a4', title: 'Jogo de Atenção e Memória', subject: 'Desenvolvimento Cognitivo',
      description: 'Jogo de memória adaptado para trabalhar foco, atenção e memória de curto prazo.',
      visualResources: ['Cartas do jogo de memória', 'Timer visual', 'Quadro de pontuação'],
      difficulty: 2, adaptedFor: ['TDAH'],
      steps: [
        { order: 1, description: 'Começar com 4 pares de figuras (versão simplificada)' },
        { order: 2, description: 'Aumentar gradualmente para 8 pares' },
        { order: 3, description: 'Registrar tempo e número de tentativas' },
        { order: 4, description: 'Celebrar conquistas com feedback visual positivo' },
      ],
    },
    {
      id: 'a5', title: 'Sequência de História com Imagens', subject: 'Português',
      description: 'Ordenação de sequência narrativa utilizando cartões ilustrados para desenvolver compreensão temporal e causal.',
      visualResources: ['Cartões de sequência narrativa', 'Painel de fixação', 'Setas direcionais'],
      difficulty: 2, adaptedFor: ['TEA', 'TDAH'],
      steps: [
        { order: 1, description: 'Apresentar os cartões de história embaralhados' },
        { order: 2, description: 'Discutir cada imagem: o que está acontecendo?' },
        { order: 3, description: 'Aluno ordena os cartões em sequência lógica' },
        { order: 4, description: 'Contar a história na sequência criada' },
      ],
    },
    {
      id: 'a6', title: 'Escrita com Apoio de Teclado Visual', subject: 'Português',
      description: 'Produção textual utilizando recurso de teclado visual e predição de palavras para alunos com dislexia.',
      visualResources: ['Tablet com app de teclado visual', 'Fone de ouvido', 'Guia de revisão ilustrado'],
      difficulty: 4, adaptedFor: ['Dislexia', 'TDAH'],
      steps: [
        { order: 1, description: 'Escolher um tema de interesse do aluno' },
        { order: 2, description: 'Ditar as ideias em voz alta (gravação de áudio)' },
        { order: 3, description: 'Transcrever usando o teclado visual com sugestões' },
        { order: 4, description: 'Revisar o texto com apoio do professor' },
      ],
    },
  ];

  for (const { steps, ...activityData } of activitiesData) {
    await prisma.activity.create({
      data: {
        ...activityData,
        steps: { create: steps },
      },
    });
  }
  console.log('📝 Atividades criadas.');

  // Routines
  await prisma.routineItem.createMany({
    data: [
      { id: 'r1', classId: 'c1', dayOfWeek: 1, time: '07:30', title: 'Acolhimento e Calendário', reminder: true, reminderText: 'Preparar calendário visual antes', color: '#6366f1' },
      { id: 'r2', classId: 'c1', dayOfWeek: 1, time: '08:00', title: 'Leitura Compartilhada', activityId: 'a1', reminder: false, color: '#0ea5e9' },
      { id: 'r3', classId: 'c1', dayOfWeek: 1, time: '09:00', title: 'Matemática Concreta', activityId: 'a3', reminder: true, reminderText: 'Separar blocos lógicos', color: '#f59e0b' },
      { id: 'r4', classId: 'c1', dayOfWeek: 1, time: '09:45', title: 'Intervalo', reminder: false, color: '#10b981' },
      { id: 'r5', classId: 'c1', dayOfWeek: 1, time: '10:00', title: 'Atividade Adaptada Individual', reminder: false, color: '#8b5cf6' },
      { id: 'r6', classId: 'c1', dayOfWeek: 1, time: '11:00', title: 'Encerramento e Organização', activityId: 'a2', reminder: true, reminderText: 'Verificar mochila com alunos TEA', color: '#ec4899' },
      { id: 'r7', classId: 'c1', dayOfWeek: 2, time: '07:30', title: 'Acolhimento e Calendário', reminder: true, reminderText: 'Preparar calendário visual antes', color: '#6366f1' },
      { id: 'r8', classId: 'c1', dayOfWeek: 2, time: '08:00', title: 'Jogo de Memória', activityId: 'a4', reminder: false, color: '#0ea5e9' },
      { id: 'r9', classId: 'c1', dayOfWeek: 2, time: '09:00', title: 'Sequência de História', activityId: 'a5', reminder: false, color: '#f59e0b' },
      { id: 'r10', classId: 'c1', dayOfWeek: 3, time: '07:30', title: 'Acolhimento', reminder: false, color: '#6366f1' },
      { id: 'r11', classId: 'c1', dayOfWeek: 3, time: '08:00', title: 'Leitura com Pictogramas', activityId: 'a1', reminder: true, reminderText: 'Preparar prancha PECS', color: '#0ea5e9' },
      { id: 'r12', classId: 'c1', dayOfWeek: 4, time: '07:30', title: 'Acolhimento', reminder: false, color: '#6366f1' },
      { id: 'r13', classId: 'c1', dayOfWeek: 4, time: '09:00', title: 'Matemática', activityId: 'a3', reminder: false, color: '#f59e0b' },
      { id: 'r14', classId: 'c1', dayOfWeek: 5, time: '07:30', title: 'Acolhimento', reminder: false, color: '#6366f1' },
      { id: 'r15', classId: 'c1', dayOfWeek: 5, time: '08:00', title: 'Produção Textual', activityId: 'a6', reminder: false, color: '#8b5cf6' },
      { id: 'r16', classId: 'c2', dayOfWeek: 1, time: '13:00', title: 'Acolhimento', reminder: false, color: '#6366f1' },
      { id: 'r17', classId: 'c2', dayOfWeek: 1, time: '13:30', title: 'Sequência de História', activityId: 'a5', reminder: false, color: '#0ea5e9' },
      { id: 'r18', classId: 'c2', dayOfWeek: 1, time: '14:30', title: 'Intervalo', reminder: false, color: '#10b981' },
      { id: 'r19', classId: 'c2', dayOfWeek: 2, time: '13:00', title: 'Acolhimento e CAA', reminder: true, reminderText: 'Verificar prancha CAA do Bruno', color: '#6366f1' },
    ],
  });
  console.log('📅 Rotinas criadas.');

  // Observations
  await prisma.lessonObservation.createMany({
    data: [
      { id: 'o1', studentId: 's1', classId: 'c1', date: '2025-02-24', behavior: 'good', participation: 'medium', completion: 'completed', notes: 'Pedro completou a atividade de pictogramas com sucesso. Menos agitação que semana anterior.', activityId: 'a1' },
      { id: 'o2', studentId: 's2', classId: 'c1', date: '2025-02-24', behavior: 'regular', participation: 'low', completion: 'completed_with_help', notes: 'Luísa precisou de lembretes frequentes para manter o foco. Completou com auxílio.', activityId: 'a1' },
      { id: 'o3', studentId: 's4', classId: 'c1', date: '2025-02-24', behavior: 'difficult', participation: 'low', completion: 'not_completed', notes: 'Sofia apresentou crise sensorial durante a atividade. Necessitou de suporte individual por 20 min.', activityId: 'a1' },
      { id: 'o4', studentId: 's1', classId: 'c1', date: '2025-02-21', behavior: 'excellent', participation: 'high', completion: 'completed', notes: 'Excelente desempenho no jogo de memória. Completou todos os pares sem ajuda.', activityId: 'a4' },
      { id: 'o5', studentId: 's2', classId: 'c1', date: '2025-02-21', behavior: 'good', participation: 'medium', completion: 'completed', notes: 'Luísa se engajou bem com o jogo. Timer visual ajudou bastante.', activityId: 'a4' },
      { id: 'o6', studentId: 's5', classId: 'c1', date: '2025-02-19', behavior: 'good', participation: 'high', completion: 'completed_with_help', notes: 'Mateus usou o teclado virtual com entusiasmo. Precisou de apoio na revisão.', activityId: 'a6' },
      { id: 'o7', studentId: 's7', classId: 'c2', date: '2025-02-24', behavior: 'good', participation: 'medium', completion: 'completed', notes: 'Bruno usou a prancha CAA para participar da roda de conversa. Grande avanço.', activityId: 'a5' },
    ],
  });
  console.log('👁️ Observações criadas.');

  // Performance Records
  await prisma.performanceRecord.createMany({
    data: [
      { id: 'pr1', studentId: 's1', activityId: 'a1', activityTitle: 'Leitura com Pictogramas', date: '2025-01-15', status: 'completed_with_help', difficultyLevel: 2, notes: 'Precisou de muita ajuda para completar.' },
      { id: 'pr2', studentId: 's1', activityId: 'a4', activityTitle: 'Jogo de Atenção e Memória', date: '2025-01-22', status: 'completed_with_help', difficultyLevel: 2, notes: 'Completou com lembretes.' },
      { id: 'pr3', studentId: 's1', activityId: 'a1', activityTitle: 'Leitura com Pictogramas', date: '2025-01-29', status: 'completed', difficultyLevel: 2, notes: 'Completou de forma independente!' },
      { id: 'pr4', studentId: 's1', activityId: 'a3', activityTitle: 'Matemática com Blocos', date: '2025-02-05', status: 'completed', difficultyLevel: 3, notes: 'Excelente desempenho.' },
      { id: 'pr5', studentId: 's1', activityId: 'a4', activityTitle: 'Jogo de Atenção e Memória', date: '2025-02-12', status: 'completed', difficultyLevel: 2, notes: 'Concluiu sem ajuda e mais rápido que antes.' },
      { id: 'pr6', studentId: 's1', activityId: 'a5', activityTitle: 'Sequência de História', date: '2025-02-19', status: 'completed', difficultyLevel: 3, notes: 'Ordenou a história corretamente.' },
      { id: 'pr7', studentId: 's1', activityId: 'a1', activityTitle: 'Leitura com Pictogramas', date: '2025-02-24', status: 'completed', difficultyLevel: 2, notes: 'Ótimo! Já consegue fazer sozinho.' },
      { id: 'pr8', studentId: 's2', activityId: 'a4', activityTitle: 'Jogo de Atenção e Memória', date: '2025-01-15', status: 'not_completed', difficultyLevel: 2, notes: 'Não conseguiu manter foco.' },
      { id: 'pr9', studentId: 's2', activityId: 'a4', activityTitle: 'Jogo de Atenção e Memória', date: '2025-01-22', status: 'completed_with_help', difficultyLevel: 2, notes: 'Com timer visual, melhorou.' },
      { id: 'pr10', studentId: 's2', activityId: 'a4', activityTitle: 'Jogo de Atenção e Memória', date: '2025-02-05', status: 'completed_with_help', difficultyLevel: 2, notes: 'Progresso constante.' },
      { id: 'pr11', studentId: 's2', activityId: 'a1', activityTitle: 'Leitura com Pictogramas', date: '2025-02-12', status: 'completed', difficultyLevel: 2, notes: 'Completou com autonomia!' },
      { id: 'pr12', studentId: 's2', activityId: 'a5', activityTitle: 'Sequência de História', date: '2025-02-19', status: 'completed', difficultyLevel: 3, notes: 'Sequenciou corretamente.' },
      { id: 'pr13', studentId: 's2', activityId: 'a1', activityTitle: 'Leitura com Pictogramas', date: '2025-02-24', status: 'completed_with_help', difficultyLevel: 2, notes: 'Dia mais agitado, precisou de apoio.' },
    ],
  });
  console.log('🏆 Registros de desempenho criados.');

  console.log('✅ Seed concluído com sucesso!');
  console.log('🔑 Contas de exemplo: admin (master), maria.silva e joao.santos (professores).');
  console.log(`   Senha de todas: ${seedPassword}${process.env.SEED_PASSWORD ? ' (definida em SEED_PASSWORD)' : ' (gerada agora; não fica salva em lugar nenhum)'}`);
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
