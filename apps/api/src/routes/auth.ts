import bcrypt from 'bcryptjs';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { ForbiddenError, UnauthorizedError } from '../errors';
import * as users from '../repositories/users';
import { openShiftForUser } from '../services/shift.service';

const router = Router();

const loginSchema = z.object({
  // e-mail não diferencia maiúsculas: o cadastro grava em minúsculas, o login
  // normaliza igual — senão a mesma conta some dependendo de como foi digitada
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

router.post('/auth/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new UnauthorizedError('credenciais inválidas');
    }
    const user = await users.findActiveByEmail(parsed.data.email);
    if (!user || !bcrypt.compareSync(parsed.data.password, user.passwordHash)) {
      throw new UnauthorizedError('credenciais inválidas');
    }

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

    const segundosDeToken = shiftEndsAt
      ? Math.max(60, Math.floor((shiftEndsAt.getTime() - Date.now()) / 1000))
      : 12 * 60 * 60;

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
