import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { ForbiddenError, UnauthorizedError } from '../errors';
import { loginRateLimit, perdoarLogin } from '../middleware/rateLimit';
import * as users from '../repositories/users';
import { MAX_SHIFT_HOURS, openShiftForUser } from '../services/shift.service';

const router = Router();

// Hash de uma senha que ninguém tem: com e-mail inexistente a comparação roda
// mesmo assim, senão o tempo de resposta entrega quais e-mails existem no
// hospital — que é justamente a lista que falta para um ataque de senha.
const HASH_ISCA = bcrypt.hashSync(randomBytes(32).toString('hex'), 10);

const loginSchema = z.object({
  // e-mail não diferencia maiúsculas: o cadastro grava em minúsculas, o login
  // normaliza igual — senão a mesma conta some dependendo de como foi digitada
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

router.post('/auth/login', loginRateLimit, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new UnauthorizedError('credenciais inválidas');
    }
    const user = await users.findActiveByEmail(parsed.data.email);
    // Sempre a versão assíncrona: o `compareSync` do bcryptjs, que é JavaScript
    // puro, segura o event loop inteiro por dezenas de milissegundos e o webhook
    // do Twilio roda neste mesmo processo.
    //
    // O que NÃO existe mais aqui é a fila. Serializar todas as verificações do
    // processo numa chave só transformava um flood de login em fila de espera
    // para quem é legítimo — a tentativa honesta ficava atrás das do atacante. E
    // era garantia de processo, que some com uma segunda instância e não existe em
    // serverless. Quem limita abuso é o limitador de tentativas da rota, que conta
    // por conta e por IP real; o custo de CPU de uma comparação avulsa é o preço
    // normal de autenticar.
    const senhaConfere = await bcrypt.compare(
      parsed.data.password,
      user?.passwordHash ?? HASH_ISCA
    );
    if (!user || !senhaConfere) {
      throw new UnauthorizedError('credenciais inválidas');
    }
    // Daqui para baixo a credencial está certa e o que vier é regra de negócio
    // (plantão fechado), não ataque. O limitador é o primeiro middleware da rota
    // e conta antes de saber disso: sem devolver as marcas, o atendente que tenta
    // entrar antes do turno chega no horário trancado por 429.
    perdoarLogin(req);

    // O atendente entra pelo plantão: o login abre a sessão de plantão e o token
    // vive exatamente o que falta dela. O admin não tem plantão.
    let shiftSessionId: string | undefined;
    let shiftEndsAt: Date | undefined;
    let availability = user.availability;

    if (user.role === 'agent') {
      const plantao = await openShiftForUser(user.tenantId, user.id);
      if (!plantao.ok) {
        throw new ForbiddenError(
          plantao.hasSchedule
            ? 'Você está fora do horário de plantão.'
            : 'Você ainda não tem escala de plantão cadastrada. Fale com o administrador.',
          { reason: 'off_shift', nextWindow: plantao.nextWindow }
        );
      }
      shiftSessionId = plantao.session.id;
      shiftEndsAt = plantao.session.endsAt;
      // abrir plantão marca a pessoa como disponível: a tela precisa refletir
      // isso agora, senão mostra "fora do ar" para quem acabou de entrar
      if (plantao.becameAvailable) availability = 'available';
    }

    // O `exp` do token não pode ser o fim do plantão lido agora: o admin pode
    // ESTENDER a escala depois do login, o `endsAt` da sessão cresce e o token já
    // assinado não acompanha — o atendente caía no meio de um plantão em curso
    // com "sessão expirada". Assinar pelo teto de duração da sessão é seguro
    // porque o fim de verdade é conferido a cada requisição em `requireAuth`,
    // contra a sessão viva no banco: encerrar o plantão continua derrubando o
    // acesso na hora.
    const segundosDeToken = (user.role === 'agent' ? MAX_SHIFT_HOURS : 12) * 60 * 60;

    const token = jwt.sign(
      { userId: user.id, tenantId: user.tenantId, role: user.role, shiftSessionId },
      config.JWT_SECRET,
      { expiresIn: segundosDeToken }
    );

    res.json({
      token,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        role: user.role,
        name: user.name,
        email: user.email,
        availability,
      },
      shift: shiftEndsAt ? { endsAt: shiftEndsAt } : null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
