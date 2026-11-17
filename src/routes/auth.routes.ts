import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { authenticate, sanitizeUser } from '../middleware/auth';
import { loginSchema } from '../validators/auth.validator';

export const authRouter = Router();

authRouter.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: parsed.email.toLowerCase() },
    });

    if (!user) {
      throw new AppError(401, 'Invalid email or password');
    }

    if (parsed.accountType && user.accountType !== parsed.accountType) {
      throw new AppError(401, `Account is not registered as ${parsed.accountType}`);
    }

    const passwordMatches = await bcrypt.compare(parsed.password, user.passwordHash);
    if (!passwordMatches) {
      throw new AppError(401, 'Invalid email or password');
    }

    if (!user.isActive) {
      throw new AppError(403, 'Account is inactive. Contact your administrator.');
    }

    const token = jwt.sign(
      { sub: user.id, accountType: user.accountType },
      env.jwtSecret,
      { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] }
    );

    res.json({
      token,
      user: sanitizeUser(user),
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});
