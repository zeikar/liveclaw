import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The launch environment every e2e suite runs the app under.
 *
 * Two things make this more than "pass a few variables".
 *
 * First, `src/main/index.ts` does `import 'dotenv/config'`, so the repo's own .env is read *inside*
 * the Electron process. A variable merely deleted from the launch env gets refilled from there. So
 * DOTENV_CONFIG_PATH points at an empty file — the .env cannot contribute anything — and the
 * variables below are set to '' rather than deleted, because dotenv does not overwrite a variable
 * that already exists.
 *
 * Second, the OpenAI key is not just another config value. getTTSConfig falls back to
 * OPENAI_API_KEY / VITE_OPENAI_API_KEY when config.json carries none, and a key reaching the app
 * arms TTS and STT against the real OpenAI API — every reply a suite produces then costs money for
 * speech synthesis. Blocking both names is a billing guard, and belongs in one place so a second
 * suite cannot quietly be launched without it.
 *
 * The caller owns `userDataDir` (and its cleanup); this writes one marker file into it.
 */
export const isolatedLaunchEnv = (userDataDir: string): NodeJS.ProcessEnv => {
  const emptyEnvFile = join(userDataDir, 'empty.env')
  writeFileSync(emptyEnvFile, '')

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Only honoured while app.isPackaged is false, which is how Playwright launches the app — so no
    // suite reads or writes the developer's real config.json.
    LIVECLAW_USER_DATA_DIR: userDataDir,
    DOTENV_CONFIG_PATH: emptyEnvFile,
    // Otherwise detection reads the developer's real ~/.openclaw/openclaw.json, which makes a run
    // depend on whether OpenClaw is installed here and what it points at.
    OPENCLAW_CONFIG_PATH: join(userDataDir, 'no-openclaw-here.json'),
    // The billing guard — see above.
    OPENAI_API_KEY: '',
    VITE_OPENAI_API_KEY: '',
    // Not billable, but they decide which gateway the app talks to; a suite's own config.json must
    // be the only thing that does.
    OPENCLAW_TOKEN: '',
    OPENCLAW_BASE_URL: ''
  }
  // Main prefers the dev server whenever this is set: always exercise the renderer that ships.
  delete env.ELECTRON_RENDERER_URL

  return env
}
