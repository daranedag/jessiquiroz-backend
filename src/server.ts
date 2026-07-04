import { env } from './config/env.js';
import { createApp, createDefaultDependencies } from './app.js';

const app = createApp(createDefaultDependencies());

app.listen(env.PORT, () => {
  console.log(`Agenda backend listening on http://localhost:${env.PORT}`);
});
