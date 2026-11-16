import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

// ─── Validação de variáveis de ambiente (fail-fast) ─────────────────────────
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET'];
const missing = requiredEnvVars.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`❌ Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}`);
  console.error('   Configure-as no arquivo .env antes de iniciar o servidor.');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.warn('⚠️  GEMINI_API_KEY não configurada — sugestões de atividade por IA ficarão indisponíveis.');
}
if (!process.env.RESEND_API_KEY) {
  console.warn('⚠️  RESEND_API_KEY não configurada — e-mails de redefinição de senha ficarão indisponíveis.');
} else if (!process.env.MAIL_FROM || process.env.MAIL_FROM.includes('resend.dev')) {
  console.warn('⚠️  MAIL_FROM usa o remetente de teste do Resend — os e-mails só chegam ao dono da conta Resend.');
  console.warn('   Verifique um domínio no Resend e defina MAIL_FROM com um endereço desse domínio.');
}

import teacherRoutes from './routes/teacherRoutes';
import classRoutes from './routes/classRoutes';
import studentRoutes from './routes/studentRoutes';
import studentProfileRoutes from './routes/studentProfileRoutes';
import activityRoutes from './routes/activityRoutes';
import routineRoutes from './routes/routineRoutes';
import observationRoutes from './routes/observationRoutes';
import performanceRoutes from './routes/performanceRoutes';
import authRoutes from './routes/authRoutes';
import aiRoutes from './routes/aiRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import passwordResetRoutes from './routes/passwordResetRoutes';
import systemLogRoutes from './routes/systemLogRoutes';
import { authenticateToken, requireRole, type AuthRequest } from './middleware/auth';

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Proxy reverso ───────────────────────────────────────────────────────────
// Em produção (Render) a conexão chega de um proxy. Sem isto, req.ip é o IP do
// proxy e o rate limit vira um contador único para todos os usuários.
// O número é a quantidade de proxies confiáveis na frente do servidor; nunca
// usar `true`, que aceitaria um X-Forwarded-For forjado pelo cliente.
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10);
app.set('trust proxy', Number.isInteger(trustProxyHops) && trustProxyHops >= 0 ? trustProxyHops : 1);

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'http://localhost:5173',
  'http://localhost:3000',
];

app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());

// ─── Rate limiting ───────────────────────────────────────────────────────────
// Limite geral: protege contra abuso em qualquer rota
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' },
});

// Limite estrito para autenticação: dificulta força bruta de senhas
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de autenticação. Tente novamente em 15 minutos.' },
});

// Limite para IA: evita abuso de custo da API do Gemini.
// Conta por usuário autenticado (a rota já passou por authenticateToken),
// para um professor não consumir a cota dos outros.
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  limit: 30,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? ipKeyGenerator(req.ip ?? ''),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Limite de uso da IA atingido. Tente novamente em 1 hora.' },
});

app.use(generalLimiter);

// Rotas públicas
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/auth', authLimiter, passwordResetRoutes);
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Rotas protegidas
app.use('/api/teachers', authenticateToken, teacherRoutes);
app.use('/api/classes', authenticateToken, classRoutes);
app.use('/api/students', authenticateToken, studentRoutes);
app.use('/api/student-profiles', authenticateToken, studentProfileRoutes);
app.use('/api/activities', authenticateToken, activityRoutes);
app.use('/api/routines', authenticateToken, routineRoutes);
app.use('/api/observations', authenticateToken, observationRoutes);
app.use('/api/performance', authenticateToken, performanceRoutes);
app.use('/api/ai', authenticateToken, aiLimiter, aiRoutes);
app.use('/api/dashboard', authenticateToken, dashboardRoutes);
app.use('/api/system-logs', authenticateToken, requireRole('master'), systemLogRoutes);

// ─── 404 para rotas não mapeadas ──────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// ─── Error handler global ─────────────────────────────────────────────────────
// Captura erros não tratados (inclui o erro de CORS) sem vazar detalhes internos
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origem não permitida' });
  }
  console.error('[Erro não tratado]', err);
  return res.status(500).json({ error: 'Erro interno do servidor' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
