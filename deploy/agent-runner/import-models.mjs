import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const [file, context, namespace, hostModels] = process.argv.slice(2)
if (!file || !context || namespace !== 'priva-harness-dev') {
  throw new Error('Pass a settings file, minikube context and priva-harness-dev namespace')
}
if (hostModels && hostModels !== '--connect-host-models') throw new Error('Unknown import option')
const contents = await readFile(file, 'utf8')
let source
try {
  source = JSON.parse(contents)
} catch {
  throw new Error('Source settings are not valid JSON; credential contents were suppressed')
}
const collection = source.modelProfiles
if (!collection || !Array.isArray(collection.profiles)) {
  throw new Error('The settings file has no modelProfiles collection')
}
for (const profile of collection.profiles) {
  if (!URL.canParse(profile.baseUrl)) throw new Error('A profile has an invalid endpoint URL; no profiles were imported')
  const endpoint = new URL(profile.baseUrl)
  if (['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(endpoint.hostname)) {
    if (hostModels !== '--connect-host-models' || endpoint.port !== '8000') {
      throw new Error('A model endpoint uses host loopback. For the Mac model service on port 8000, explicitly pass --connect-host-models; otherwise configure it in the new UI.')
    }
    endpoint.hostname = 'host.minikube.internal'
    profile.baseUrl = endpoint.toString().replace(/\/$/u, '')
  }
}

// Only modelProfiles crosses stdin. Tokens never become argv, shell text,
// terminal output, a ConfigMap, or a file in the repository.
const script = `
  import { JsonRuntimeSettingsStore } from './dist/infrastructure/settings/json-runtime-settings-store.js';
  import { parseModelProfileCollection } from './dist/core/resource/model-profile.js';
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const modelProfiles = parseModelProfileCollection(JSON.parse(input));
  const settings = new JsonRuntimeSettingsStore({filePath: process.env.RUNTIME_HOME_DIR + '/bambuddy.settings.json'});
  await settings.transact(current => ({settings: {...current, modelProfiles}, result: undefined}));
  console.log('Imported ' + modelProfiles.profiles.length + ' model profiles; other settings and native configs were preserved.');
`
const result = spawnSync('kubectl', [
  '--context', context, '--namespace', namespace,
  'exec', '-i', 'deployment/agent-runner', '--',
  'node', '--input-type=module', '-e', script,
], { input: JSON.stringify(collection), stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' })
if (result.error) throw result.error
if (result.status !== 0) {
  // Do not echo downstream parsing errors that might contain credential input.
  throw new Error('Model import failed. Check Pod readiness and settings schema; credential output was suppressed.')
}
process.stdout.write(result.stdout)
