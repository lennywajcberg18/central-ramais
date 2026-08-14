import bcrypt from 'bcryptjs';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { UnauthorizedError } from '../errors';
import * as users from '../repositories/users';

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

    const token = jwt.sign(
      { userId: user.id, tenantId: user.tenantId, role: user.role },
      config.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        role: user.role,
        name: user.name,
        email: user.email,
        availability: user.availability,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
