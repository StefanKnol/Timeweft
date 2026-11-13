/**
 * Where the database is, read from the environment.
 *
 * The address is given in parts, one setting each, because that is how a container's settings are
 * filled in and because a password is then typed as it is: no character in it has to be encoded
 * by hand to survive inside an address. The parts are put together here, encoded properly.
 *
 * A whole address in TIMEWEFT_DATABASE_URL is still taken, for a setup that already has one. The
 * two ways are never mixed: with both given there would be two answers to where the database is,
 * so that is refused.
 */
export const DATABASE_VARIABLES = {
  host: 'TIMEWEFT_DATABASE_HOST',
  port: 'TIMEWEFT_DATABASE_PORT',
  name: 'TIMEWEFT_DATABASE_NAME',
  user: 'TIMEWEFT_DATABASE_USER',
  password: 'TIMEWEFT_DATABASE_PASSWORD',
  wholeAddress: 'TIMEWEFT_DATABASE_URL',
} as const;

export const DEFAULT_DATABASE_PORT = 5432;
export const DEFAULT_DATABASE_NAME = 'timeweft';

/** A setting the person can act on is missing or wrong. The sentence says which and how. */
export class DatabaseAddressNotSet extends Error {
  override name = 'DatabaseAddressNotSet';
}

function settingOf(environment: Record<string, string | undefined>, variable: string): string {
  return environment[variable]?.trim() ?? '';
}

/** The PostgreSQL address the store opens, as one piece of text. */
export function databaseAddressFromEnvironment(environment: Record<string, string | undefined>): string {
  const wholeAddress = settingOf(environment, DATABASE_VARIABLES.wholeAddress);
  const host = settingOf(environment, DATABASE_VARIABLES.host);
  const portText = settingOf(environment, DATABASE_VARIABLES.port);
  const name = settingOf(environment, DATABASE_VARIABLES.name);
  const user = settingOf(environment, DATABASE_VARIABLES.user);
  // A password is taken exactly as given: a space at either end may be part of it.
  const password = environment[DATABASE_VARIABLES.password] ?? '';

  const partsGiven = [
    [DATABASE_VARIABLES.host, host], [DATABASE_VARIABLES.port, portText], [DATABASE_VARIABLES.name, name],
    [DATABASE_VARIABLES.user, user], [DATABASE_VARIABLES.password, password],
  ].filter(([, value]) => value !== '').map(([variable]) => variable);

  if (wholeAddress !== '') {
    if (partsGiven.length > 0) {
      throw new DatabaseAddressNotSet(`${DATABASE_VARIABLES.wholeAddress} is set, and so ${partsGiven.length === 1 ? 'is' : 'are'} ${partsGiven.join(', ')}. That is two answers to where the database is. Set the parts, or the whole address, not both.`);
    }
    return wholeAddress;
  }

  const missing = [
    [DATABASE_VARIABLES.host, host], [DATABASE_VARIABLES.user, user], [DATABASE_VARIABLES.password, password],
  ].filter(([, value]) => value === '').map(([variable]) => variable);
  if (missing.length > 0) {
    throw new DatabaseAddressNotSet(`The database is not named: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. Set ${DATABASE_VARIABLES.host} (the address of PostgreSQL), ${DATABASE_VARIABLES.user} and ${DATABASE_VARIABLES.password}; ${DATABASE_VARIABLES.port} is ${DEFAULT_DATABASE_PORT} and ${DATABASE_VARIABLES.name} is "${DEFAULT_DATABASE_NAME}" unless you set them.`);
  }
  if (/[\s/@]/.test(host) || host.includes('://')) {
    throw new DatabaseAddressNotSet(`${DATABASE_VARIABLES.host} is the address of PostgreSQL alone: a name or an IP address, with no "postgres://", no port and no path. The port goes in ${DATABASE_VARIABLES.port}.`);
  }
  let port = DEFAULT_DATABASE_PORT;
  if (portText !== '') {
    port = Number(portText);
    if (!/^[0-9]+$/.test(portText) || port < 1 || port > 65535) {
      throw new DatabaseAddressNotSet(`${DATABASE_VARIABLES.port} must be a whole number from 1 to 65535; "${portText}" is not.`);
    }
  }
  // An IPv6 address is written in brackets inside an address, so its colons are not read as a port.
  const hostInAnAddress = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const databaseName = name === '' ? DEFAULT_DATABASE_NAME : name;
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${hostInAnAddress}:${port}/${encodeURIComponent(databaseName)}`;
}
