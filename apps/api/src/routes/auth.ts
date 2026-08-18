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
import { runSerialized } from '../utils/keyedQueue';

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
    // Uma verificação de senha por vez, e sempre a versão assíncrona. O bcryptjs
    // é JavaScript puro: cada comparação custa dezenas de milissegundos de CPU e
    // o `compareSync` segurava o event loop inteiro. Em paralelo é pior — 40
    // tentativas viram segundos de CPU contínua e o webhook do Twilio, que roda
    // neste mesmo processo, fica para trás e as mensagens dos pacientes atrasam.
    // Na fila, cada tentativa espera a anterior e o loop respira entre elas.
    const senhaConfere = await runSerialized('login:senha', () =>
      bcrypt.compare(parsed.data.password, user?.passwordHash ?? HASH_ISCA)
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
