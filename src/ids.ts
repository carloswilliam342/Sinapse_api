import { z } from 'zod';

// IDs de registro recebidos no corpo das requisições.
//
// Os registros criados pelo sistema usam UUID, mas os dados de exemplo do seed
// usam IDs curtos (s1, c1, a1, t1, admin). Exigir UUID fazia a API recusar com
// "Dados inválidos" qualquer observação, desempenho, rotina, aluno ou turma
// ligado a eles. O formato não protege nada: cada rota confere no banco se o
// registro existe e se o usuário pode usá-lo.
export const recordId = (message = 'ID inválido') => z.string().trim().min(1, message).max(64, message);

// Id opcional: aceita ausente, null ou '' (o front manda '' quando nada foi escolhido)
export const optionalRecordId = () => recordId().nullable().optional().or(z.literal('').transform(() => null));
