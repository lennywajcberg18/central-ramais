import { config } from './config';
import { createApp } from './app';
import { startShiftJob } from './jobs/shift';
import { startTimeoutJob } from './jobs/timeout';

const app = createApp();

app.listen(config.PORT, () => {
  console.log(`[api] ouvindo em http://localhost:${config.PORT}`);
  startTimeoutJob();
  startShiftJob();
});
