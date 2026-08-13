import { Router } from 'express';
import { resolveRedirect } from '../services/entryLink.service';

const router = Router();

const GONE_PAGE = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Link indisponível</title></head>
<body style="font-family:sans-serif;text-align:center;padding-top:4rem">
<h1>Link indisponível</h1>
<p>Este link de acesso não existe ou foi encerrado. Procure o hospital.</p>
</body></html>`;

router.get('/c/:slug', async (req, res, next) => {
  try {
    const target = await resolveRedirect(req.params.slug);
    if (!target) {
      res.status(404).type('html').send(GONE_PAGE);
      return;
    }
    res.redirect(302, target.url);
  } catch (err) {
    next(err);
  }
});

export default router;
