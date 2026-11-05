import type { SandboxCallToolResult } from '@lobechat/builtin-tool-cloud-sandbox';
import { isRecord } from '@lobechat/utils';
import debug from 'debug';
import { sha256 } from 'js-sha256';

import { sandboxEnv } from '@/envs/sandbox';

import type {
  SandboxProvider,
  SandboxProviderCapabilities,
  SandboxProviderFileExportRequest,
  SandboxProviderFileExportResult,
  SandboxServiceOptions,
} from '../types';
import {
  appendWriteFileChunkScript,
  editFileScript,
  globFilesScript,
  grepContentScript,
  listFilesScript,
  moveFilesScript,
  prepareWriteFileScript,
  readFileScript,
  scriptPrelude,
  searchFilesScript,
} from './onlyboxes';

const log = debug('lobe-server:sandbox:openbot');

const DEFAULT_TIMEOUT_MS = 120_000;
/** The agent-computer `/exec` endpoint rejects timeouts outside this range. */
const EXEC_MIN_TIMEOUT_MS = 1000;
const EXEC_MAX_TIMEOUT_MS = 600_000;
/** How long a resolved computer URL is reused before the supervisor is asked again. */
const COMPUTER_URL_TTL_MS = 60_000;
/**
 * Linux caps a single argv string at 128 KiB, and the whole command travels as one `bash -c`
 * argument, so file content is written in chunks whose base64 form stays well below that.
 */
const WRITE_FILE_CHUNK_BYTES = 48 * 1024;
const BACKGROUND_DIR = '/tmp/lobe-bg';
const SKILL_ARCHIVE_CACHE_DIR = '/tmp/lobe-skills';

interface ComputerState {
  botId?: string;
  error?: string;
  status?: string;
  url?: string;
}

interface ShellResult {
  elapsedMs?: number;
  exitCode: number;
  stderr: string;
  stdout: string;
  timedOut?: boolean;
  truncated?: boolean;
}

const computerUrlCache = new Map<string, { expiresAt: number; url: string }>();

/** Test hook: the cache is module state shared by every provider instance. */
export const clearOpenBotComputerCache = () => computerUrlCache.clear();

/**
 * Cloud Sandbox backed by an OpenBot computer: a container with Chromium, a durable `/workspace`
 * and a shell, created on demand by the OpenBot supervisor.
 *
 * Every tool is expressed as a shell command run through the computer's `/exec` endpoint. File tools
 * reuse the Onlyboxes Python scripts, so both providers return identical result shapes.
 */
export class OpenBotSandboxProvider implements SandboxProvider {
  readonly capabilities = {
    backgroundCommands: true,
    exportFile: true,
    files: true,
    languages: ['python', 'javascript', 'typescript'],
    persistentSession: true,
    shell: true,
    skillScripts: true,
  } as const satisfies SandboxProviderCapabilities;

  readonly kind = 'openbot';

  private readonly computerToken: string;
  private readonly options: SandboxServiceOptions;
  private readonly scope: 'topic' | 'user';
  private readonly supervisorToken: string;
  private readonly supervisorUrl: string;

  constructor(options: SandboxServiceOptions) {
    this.options = options;
    this.supervisorUrl = (sandboxEnv.OPENBOT_SUPERVISOR_URL || '').replace(/\/+$/, '');
    this.supervisorToken = sandboxEnv.OPENBOT_SUPERVISOR_TOKEN || '';
    this.computerToken = sandboxEnv.OPENBOT_COMPUTER_TOKEN || '';
    this.scope = sandboxEnv.OPENBOT_COMPUTER_SCOPE || 'user';
  }

  async callTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    const missing = this.missingConfig();
    if (missing) return this.errorResult(missing);

    try {
      switch (toolName) {
        case 'runCommand': {
          return await this.runCommand(params);
        }

        case 'getCommandOutput': {
          return await this.getCommandOutput(params);
        }

        case 'killCommand': {
          return await this.killCommand(params);
        }

        case 'executeCode': {
          return await this.executeCode(params);
        }

        case 'execScript': {
          return await this.execScript(params);
        }

        case 'listLocalFiles':
        case 'listFiles': {
          return await this.runJsonScript(listFilesScript, params);
        }

        case 'readLocalFile':
        case 'readFile': {
          return await this.runJsonScript(readFileScript, params);
        }

        case 'writeLocalFile':
        case 'writeFile': {
          return await this.writeLocalFile(params);
        }

        case 'editLocalFile':
        case 'editFile': {
          return await this.runJsonScript(editFileScript, params);
        }

        case 'searchLocalFiles':
        case 'searchFiles': {
          return await this.runJsonScript(searchFilesScript, params);
        }

        case 'moveLocalFiles':
        case 'moveFiles': {
          return await this.runJsonScript(moveFilesScript, params);
        }

        case 'grepContent': {
          return await this.runJsonScript(grepContentScript, params);
        }

        case 'globLocalFiles':
        case 'globFiles': {
          return await this.runJsonScript(globFilesScript, params);
        }

        default: {
          return this.errorResult(`Unsupported OpenBot sandbox tool: ${toolName}`);
        }
      }
    } catch (error) {
      log('OpenBot tool %s failed: %O', toolName, error);
      return this.errorResult((error as Error).message, (error as Error).name);
    }
  }

  async exportFileToUploadUrl({
    path,
    uploadHeaders,
    uploadUrl,
  }: SandboxProviderFileExportRequest): Promise<SandboxProviderFileExportResult> {
    const missing = this.missingConfig();
    if (missing) return { error: { message: missing }, success: false };

    try {
      const exported = await this.runJsonScript(
        exportFileScript,
        { headers: uploadHeaders || {}, path, url: uploadUrl },
        DEFAULT_TIMEOUT_MS,
      );

      if (!exported.success) {
        return {
          error: {
            message: exported.error?.message || 'Failed to export file from OpenBot computer',
          },
          success: false,
        };
      }

      const result = exported.result as Record<string, unknown>;

      return {
        mimeType: typeof result.mimeType === 'string' ? result.mimeType : undefined,
        result,
        size: typeof result.size === 'number' ? result.size : undefined,
        success: true,
      };
    } catch (error) {
      log('OpenBot export failed: %O', error);
      return { error: { message: (error as Error).message }, success: false };
    }
  }

  /** The supervisor only accepts plain ids of at most 64 characters, so the scope is hashed. */
  private get computerId() {
    if (this.scope === 'topic') {
      return `t-${sha256(`${this.options.userId}:${this.options.topicId}`).slice(0, 40)}`;
    }

    return `u-${sha256(this.options.userId).slice(0, 40)}`;
  }

  private missingConfig() {
    if (!this.supervisorUrl || !this.supervisorToken || !this.computerToken) {
      return 'OPENBOT_SUPERVISOR_URL, OPENBOT_SUPERVISOR_TOKEN and OPENBOT_COMPUTER_TOKEN are required';
    }
  }

  private async runCommand(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const command = String(params.command || '');

    if (!command.trim()) {
      return this.errorResult('command is required');
    }

    if (params.background === true) {
      return this.startBackgroundCommand(command);
    }

    const result = await this.exec(command, this.timeout(params));

    return {
      result: {
        exitCode: result.exitCode,
        output: result.stdout,
        stderr: result.stderr,
        stdout: result.stdout,
        success: result.exitCode === 0,
        timedOut: result.timedOut,
        truncated: result.truncated,
      },
      success: true,
    };
  }

  /**
   * `/exec` waits for the command, so a background command is detached inside the computer and its
   * output kept in files that `getCommandOutput` reads back.
   *
   * `setsid` gives it a process group of its own: `/exec` kills its own group when a request times
   * out or is aborted, and the background command must outlive that request. Its pid is then also its
   * group id, which is what `killCommand` signals so the command's children stop with it.
   */
  private async startBackgroundCommand(command: string): Promise<SandboxCallToolResult> {
    const commandId = `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const base = `${BACKGROUND_DIR}/${commandId}`;
    const quotedBase = shellQuote(base);
    const script = [
      `mkdir -p ${shellQuote(BACKGROUND_DIR)}`,
      `{ setsid nohup bash -c ${shellQuote(`${command}; echo $? > ${base}.exit`)} > ${quotedBase}.out 2> ${quotedBase}.err < /dev/null & echo $! > ${quotedBase}.pid; }`,
    ].join(' && ');

    const started = await this.exec(script, DEFAULT_TIMEOUT_MS);

    if (started.exitCode !== 0) {
      return this.errorResult(started.stderr || 'Failed to start OpenBot background command');
    }

    return { result: { commandId, shell_id: commandId }, success: true };
  }

  private async getCommandOutput(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const commandId = this.backgroundCommandId(params);
    if (!commandId) return this.errorResult('commandId is required');

    return this.runJsonScript(commandOutputScript, { base: `${BACKGROUND_DIR}/${commandId}` });
  }

  private async killCommand(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const commandId = this.backgroundCommandId(params);
    if (!commandId) return this.errorResult('commandId is required');

    const pidFile = shellQuote(`${BACKGROUND_DIR}/${commandId}.pid`);
    const result = await this.exec(
      `if [ -f ${pidFile} ]; then kill -TERM -- "-$(cat ${pidFile})" 2>/dev/null; echo stopped; else echo missing; fi`,
      DEFAULT_TIMEOUT_MS,
    );

    if (result.stdout.trim() === 'missing') return this.errorResult('Unknown commandId');

    return { result: { success: true }, success: true };
  }

  private backgroundCommandId(params: Record<string, unknown>) {
    const commandId = String(params.commandId || '');
    return /^bg-[\da-z-]+$/.test(commandId) ? commandId : '';
  }

  private async executeCode(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const code = String(params.code || '');
    const language = String(params.language || 'python');
    const runner = CODE_RUNNERS[language];

    if (!runner) {
      return this.errorResult(`Unsupported code language for OpenBot sandbox: ${language}`);
    }

    const filePath = `/tmp/lobe-code-${Date.now()}.${runner.extension}`;
    const written = await this.writeTextFile({
      content: code,
      createDirectories: true,
      path: filePath,
      timeoutMs: this.timeout(params),
    });

    if (!written.success) return written;

    const result = await this.exec(
      `${runner.command} ${shellQuote(filePath)}`,
      this.timeout(params),
    );

    return {
      result: {
        error: result.exitCode === 0 ? undefined : result.stderr,
        exitCode: result.exitCode,
        output: result.stdout,
        stderr: result.stderr,
      },
      success: true,
    };
  }

  private async execScript(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const command = String(params.command || '');

    if (!command.trim()) {
      return this.errorResult('command is required');
    }

    const skillZipUrls = resolveSkillZipUrls(params);
    const timeoutMs = this.timeout(params);

    if (Object.keys(skillZipUrls).length === 0) {
      return this.runCommand({ command, timeout: timeoutMs });
    }

    const workspaceDir = skillWorkspaceDir(skillZipUrls);
    const setup = await this.exec(buildSkillSetupCommand(skillZipUrls, workspaceDir), timeoutMs);

    if (setup.exitCode !== 0) {
      return {
        error: { message: setup.stderr || setup.stdout || 'Failed to prepare skill resources' },
        result: { exitCode: setup.exitCode, output: setup.stdout, stderr: setup.stderr },
        success: false,
      };
    }

    const skillName = resolveSkillName(params, skillZipUrls);
    const runDir = skillName ? `${workspaceDir}/${safeSkillDirName(skillName)}` : workspaceDir;
    const result = await this.exec(`cd ${shellQuote(runDir)} && ${command}`, timeoutMs);

    return {
      result: {
        exitCode: result.exitCode,
        output: result.stdout,
        stderr: result.stderr,
        stdout: result.stdout,
        success: result.exitCode === 0,
      },
      success: true,
    };
  }

  private async writeLocalFile(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const path = String(params.path || '');

    if (!path) {
      return this.errorResult('path is required');
    }

    return this.writeTextFile({
      content: String(params.content || ''),
      createDirectories: params.createDirectories === true,
      path,
      timeoutMs: this.timeout(params),
    });
  }

  private async writeTextFile({
    content,
    createDirectories,
    path,
    timeoutMs,
  }: {
    content: string;
    createDirectories: boolean;
    path: string;
    timeoutMs: number;
  }): Promise<SandboxCallToolResult> {
    const init = await this.runJsonScript(
      prepareWriteFileScript,
      { createDirectories, path },
      timeoutMs,
    );

    if (!init.success) return init;

    const bytes = Buffer.from(content);
    let bytesWritten = 0;

    for (let offset = 0; offset < bytes.length; offset += WRITE_FILE_CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + WRITE_FILE_CHUNK_BYTES).toString('base64');
      const appended = await this.runJsonScript(
        appendWriteFileChunkScript,
        { chunk, path },
        timeoutMs,
      );

      if (!appended.success) return appended;

      bytesWritten += Number(appended.result?.bytesWritten || 0);
    }

    return { result: { bytesWritten, success: true }, success: true };
  }

  private async runJsonScript(
    script: string,
    params: Record<string, unknown>,
    timeoutMs = this.timeout(params),
  ): Promise<SandboxCallToolResult> {
    const encoded = Buffer.from(JSON.stringify(params)).toString('base64');
    const command = `python3 - <<'PY'\n${script}\nmain('${encoded}')\nPY`;
    const result = await this.exec(command, timeoutMs);

    if (result.exitCode !== 0) {
      return {
        error: { message: result.stderr || result.stdout || 'OpenBot script failed' },
        result: null,
        success: false,
      };
    }

    try {
      const parsed = JSON.parse(result.stdout || '{}') as Record<string, unknown>;

      if (parsed.success === false) {
        return {
          error: { message: String(parsed.error || 'OpenBot script failed') },
          result: parsed,
          success: false,
        };
      }

      return { result: parsed, success: true };
    } catch (error) {
      return {
        error: { message: `Failed to parse OpenBot script output: ${(error as Error).message}` },
        result: { output: result.stdout, stderr: result.stderr },
        success: false,
      };
    }
  }

  private async exec(command: string, timeoutMs: number): Promise<ShellResult> {
    const computerUrl = await this.ensureComputer();
    const boundedTimeout = Math.min(Math.max(timeoutMs, EXEC_MIN_TIMEOUT_MS), EXEC_MAX_TIMEOUT_MS);

    return this.request<ShellResult>(`${computerUrl}/exec`, {
      body: JSON.stringify({ command, timeoutMs: boundedTimeout }),
      headers: {
        'Authorization': `Bearer ${this.computerToken}`,
        'x-openbot-bot-id': this.computerId,
      },
      method: 'POST',
    });
  }

  /** Asks the supervisor for this scope's computer, starting it when it is not running. */
  private async ensureComputer(): Promise<string> {
    const computerId = this.computerId;
    const cached = computerUrlCache.get(computerId);

    if (cached && cached.expiresAt > Date.now()) return cached.url;

    const state = await this.request<ComputerState>(
      `${this.supervisorUrl}/computers/${computerId}/ensure`,
      {
        headers: { Authorization: `Bearer ${this.supervisorToken}` },
        method: 'POST',
      },
    );

    if (!state.url) {
      throw new Error(`OpenBot supervisor returned no address for computer ${computerId}`);
    }

    const url = state.url.replace(/\/+$/, '');
    computerUrlCache.set(computerId, { expiresAt: Date.now() + COMPUTER_URL_TTL_MS, url });
    log('Computer %s is %s at %s', computerId, state.status, url);

    return url;
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(url, { ...init, headers });
    const body = await response.text();
    const json = body ? JSON.parse(body) : {};

    if (!response.ok) {
      throw new Error(
        typeof json?.error === 'string'
          ? json.error
          : `OpenBot request failed with HTTP ${response.status}`,
      );
    }

    return json as T;
  }

  private timeout(params: Record<string, unknown>) {
    const value = params.timeout ?? params.timeout_ms;
    return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_TIMEOUT_MS;
  }

  private errorResult(message: string, name?: string): SandboxCallToolResult {
    return { error: { message, name }, result: null, success: false };
  }
}

const CODE_RUNNERS: Record<string, { command: string; extension: string }> = {
  javascript: { command: 'node', extension: 'js' },
  python: { command: 'python3', extension: 'py' },
  typescript: { command: 'npx --yes tsx', extension: 'ts' },
};

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const safeSkillDirName = (name: string) => name.replaceAll(/[^\w.-]/g, '-');

const resolveSkillZipUrls = (params: Record<string, unknown>): Record<string, string> => {
  if (typeof params.zipUrl === 'string' && params.zipUrl) {
    const configName = isRecord(params.config) ? params.config.name : undefined;
    const activated = Array.isArray(params.activatedSkills)
      ? [...params.activatedSkills]
          .reverse()
          .find((skill) => isRecord(skill) && typeof skill.name === 'string' && skill.name)
      : undefined;
    const name =
      (typeof configName === 'string' && configName) ||
      (isRecord(activated) ? String(activated.name) : undefined) ||
      'default';

    return { [name]: params.zipUrl };
  }

  if (!isRecord(params.skillZipUrls)) return {};

  return Object.fromEntries(
    Object.entries(params.skillZipUrls).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1],
    ),
  );
};

const resolveSkillName = (
  params: Record<string, unknown>,
  skillZipUrls: Record<string, string>,
) => {
  const configName = isRecord(params.config) ? params.config.name : undefined;
  if (typeof configName === 'string' && skillZipUrls[configName]) return configName;

  if (Array.isArray(params.activatedSkills)) {
    for (const skill of [...params.activatedSkills].reverse()) {
      if (isRecord(skill) && typeof skill.name === 'string' && skillZipUrls[skill.name]) {
        return skill.name;
      }
    }
  }

  return Object.keys(skillZipUrls)[0];
};

const skillWorkspaceDir = (skillZipUrls: Record<string, string>) => {
  const entries = Object.entries(skillZipUrls).sort(([left], [right]) => left.localeCompare(right));
  return `${SKILL_ARCHIVE_CACHE_DIR}/${sha256(JSON.stringify(entries)).slice(0, 32) || 'default'}`;
};

const buildSkillSetupCommand = (skillZipUrls: Record<string, string>, workspaceDir: string) => {
  const setup = Object.entries(skillZipUrls).map(([name, zipUrl]) => {
    const skillDir = `${workspaceDir}/${safeSkillDirName(name)}`;
    const marker = shellQuote(`${skillDir}/.prepared`);
    const archive = shellQuote(`${skillDir}/skill.zip`);
    const dir = shellQuote(skillDir);

    return `if [ ! -f ${marker} ]; then rm -rf ${dir} && mkdir -p ${dir} && curl -fsSL ${shellQuote(zipUrl)} -o ${archive} && unzip -q ${archive} -d ${dir} && printf prepared > ${marker}; fi`;
  });

  return [`mkdir -p ${shellQuote(workspaceDir)}`, ...setup].join(' && ');
};

const commandOutputScript = `${scriptPrelude}
def read(path):
    try:
        return Path(path).read_text(errors='replace')
    except FileNotFoundError:
        return None

def main(encoded):
    args = load_args(encoded)
    base = args.get('base')
    pid = read(base + '.pid')
    if pid is None:
        emit({'success': False, 'error': 'Unknown commandId'})
        return
    exit_code = read(base + '.exit')
    running = exit_code is None
    output = read(base + '.out') or ''
    stderr = read(base + '.err') or ''
    emit({
        'exitCode': None if running else int(exit_code.strip() or 0),
        'newOutput': output,
        'output': output,
        'running': running,
        'stderr': stderr,
        'success': True,
    })
`;

const exportFileScript = `${scriptPrelude}
import mimetypes, urllib.request

def main(encoded):
    args = load_args(encoded)
    path = Path(args.get('path'))
    data = path.read_bytes()
    mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    request = urllib.request.Request(args.get('url'), data=data, method='PUT')
    for key, value in (args.get('headers') or {}).items():
        request.add_header(key, value)
    with urllib.request.urlopen(request, timeout=110) as response:
        status = response.status
    emit({'mimeType': mime, 'size': len(data), 'status': status, 'success': status < 300})
`;
