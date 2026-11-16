import { ApiError, GoogleGenAI } from '@google/genai';

// Único ponto do sistema que fala com o provedor de IA. As rotas pedem "um JSON
// neste formato para este prompt" e não sabem qual modelo ou fornecedor
// responde. Trocar de modelo (ou de fornecedor) é mexer só neste arquivo.

export type AiStep = 'suggestion' | 'material';

export type AiErrorKind = 'not_configured' | 'student_data_disabled' | 'quota' | 'unavailable' | 'empty' | 'bad_output';

export class AiError extends Error {
  readonly kind: AiErrorKind;

  constructor(kind: AiErrorKind, message: string) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
  }
}

// Remover o nome não torna diagnósticos e histórico anônimos. No plano gratuito
// esses dados não podem ser enviados ao Google. Habilitar apenas depois de
// configurar Cloud Billing ativo no projeto e avaliar o uso dos dados da escola.
export function assertStudentDataAllowed(): void {
  if (process.env.GEMINI_ALLOW_STUDENT_DATA !== 'true') {
    throw new AiError(
      'student_data_disabled',
      'A IA não está habilitada para usar dados de alunos. Use uma atividade sem aluno vinculado ou consulte o administrador.',
    );
  }
}

// Cada etapa tem seu próprio modelo. Reservar o 3.8 para os materiais evita
// consumir a cota dele também nas sugestões. Não trocar modelos automaticamente
// em falhas: isso poderia consumir a cota reservada para outra etapa.
const DEFAULT_MODELS: Record<AiStep, string> = {
  suggestion: 'gemini-3.5-flash-lite',
  material: 'gemini-3.8-flash',
};
const TIMEOUT_MS = 90_000;

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AiError('not_configured', 'A IA não está configurada no servidor (GEMINI_API_KEY ausente).');
  }
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

// Configurar uma etapa não altera a outra. Variável vazia usa o padrão.
function modelFor(step: AiStep): string {
  const configured = step === 'material' ? process.env.GEMINI_MODEL_MATERIAL : process.env.GEMINI_MODEL;
  return configured?.trim() || DEFAULT_MODELS[step];
}

// Pede ao modelo um JSON no formato de `jsonSchema`. Devolve o JSON já
// convertido, sem validar o conteúdo: quem chama valida, porque o modelo pode
// respeitar o formato e ainda assim devolver valores fora do esperado.
export async function generateJson(step: AiStep, prompt: string, jsonSchema: object): Promise<unknown> {
  const ai = getClient();
  const model = modelFor(step);
  let text: string | undefined;
  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema,
        // Uma ação do professor faz uma tentativa, preservando a cota diária.
        httpOptions: { timeout: TIMEOUT_MS, retryOptions: { attempts: 1 } },
      },
    });
    text = response.text;
  } catch (error) {
    console.error('[IA] Falha na chamada ao provedor:', {
      step, model,
      status: error instanceof ApiError ? error.status : undefined,
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    if (error instanceof ApiError && error.status === 429) {
      throw new AiError('quota', 'O limite de uso da IA foi atingido. Aguarde a renovação da cota para tentar novamente.');
    }
    if (error instanceof ApiError && error.status === 404) {
      throw new AiError('unavailable', 'O modelo de IA configurado para esta etapa está indisponível. Consulte o administrador.');
    }
    throw new AiError('unavailable', 'A IA está indisponível no momento. Tente de novo em instantes.');
  }

  // Resposta bloqueada pelos filtros do provedor chega sem texto, não como erro.
  if (!text) {
    throw new AiError('empty', 'A IA não devolveu conteúdo para este pedido. Tente reformular o tema.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('bad_output', 'A IA devolveu uma resposta fora do formato esperado. Tente de novo.');
  }
}

// Status HTTP que cada tipo de falha vira na resposta da API
export const AI_ERROR_STATUS: Record<AiErrorKind, number> = {
  not_configured: 503,
  student_data_disabled: 403,
  quota: 429,
  unavailable: 503,
  empty: 502,
  bad_output: 502,
};
