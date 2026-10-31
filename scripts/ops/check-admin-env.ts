/**
 * Strynkix LMS — report which server (Admin SDK) variables are set in the
 * current shell, by name only. Never prints values. Makes no network request.
 *   npm run check:admin-env
 */
import { ADMIN_VARIABLES, missingAdminVariables } from '../../src/lib/server/firebase-admin';
import { PRODUCTION_PROJECT_ID, STAGING_PROJECT_ID } from '../../src/lib/firebase/project-ids';

const env = process.env;
for (const name of ADMIN_VARIABLES) console.log(`${name.padEnd(30)} ${env[name] ? 'set' : 'MISSING'}`);
const project = env.FIREBASE_ADMIN_PROJECT_ID;
if (project === PRODUCTION_PROJECT_ID) console.log('WARNING: FIREBASE_ADMIN_PROJECT_ID names the production project; the server refuses it.');
else if (project && project !== STAGING_PROJECT_ID && !project.startsWith('demo-')) console.log(`Note: FIREBASE_ADMIN_PROJECT_ID is not ${STAGING_PROJECT_ID}.`);
if (env.FIREBASE_ADMIN_PRIVATE_KEY && !env.FIREBASE_ADMIN_PRIVATE_KEY.includes('PRIVATE KEY')) console.log('WARNING: FIREBASE_ADMIN_PRIVATE_KEY does not look like a PEM private key.');
if (env.ALLOW_PRODUCTION_ADMIN) console.log('WARNING: ALLOW_PRODUCTION_ADMIN is set; it must not be set for staging.');
const missing = missingAdminVariables(env);
console.log(missing.length ? `Not ready: ${missing.length} variable(s) missing.` : 'All Admin variables are set.');
process.exitCode = missing.length ? 1 : 0;
