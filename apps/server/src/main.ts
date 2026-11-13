/**
 * Starts the server: reads its settings, opens and migrates the store, listens, and closes both
 * cleanly when it is told to stop.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from '@timeweft/store';
import { accessSettingsFromEnvironment } from './access.ts';
import { databaseAddressFromEnvironment } from './database-address.ts';
import { createTimeweftServer } from './http-server.ts';

const DEFAULT_PORT = 4400;

/** The web app's built folder, beside this app in the repository. */
const WEB_ROOT = fileURLToPath(new URL('../../web/dist', import.meta.url));

function portFromEnvironment(text: string | undefined): number {
  if (text === undefined || text.trim() === '') return DEFAULT_PORT;
  const port = Number(text);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PORT must be a whole number from 0 to 65535; "${text}" is not.`);
  return port;
}

async function main(): Promise<void> {
  const databaseUrl = databaseAddressFromEnvironment(process.env);
  const access = accessSettingsFromEnvironment(process.env);
  const port = portFromEnvironment(process.env['PORT']);
  const schema = process.env['TIMEWEFT_DATABASE_SCHEMA']?.trim();

  const store = await openStore(databaseUrl, schema === undefined || schema === '' ? {} : { schema });
  await store.migrate();
  const server = createTimeweftServer({ ...access, store, webRoot: existsSync(WEB_ROOT) ? WEB_ROOT : null });

  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    server.close(() => {
      store.close().then(() => process.exit(0), (error: unknown) => {
        console.error('Closing the store failed:', error);
        process.exit(1);
      });
    });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  server.listen(port, () => {
    const address = server.address();
    const listeningOn = typeof address === 'object' && address !== null ? address.port : port;
    console.log(`Timeweft is listening on port ${listeningOn}${access.accessToken === null ? ', with no access token (local use only)' : ''}.`);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
