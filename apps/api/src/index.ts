import express from 'express';

const app = express();

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const port = 3001;
app.listen(port, () => {
  console.log(`[api] ouvindo em http://localhost:${port}`);
});
