import { VirtualFileSystem } from './index';

export type ShellOpts = {
  cwd?: string;
  timeoutMs?: number;
};

export type ShellResult = {
  stdout: string;
  stderr: string;
  exitCode: number; // 0 success
};

const TRUNCATE_CHARS = 100000;

function truncate(out: string): string {
  if (out.length > TRUNCATE_CHARS) {
    return out.slice(0, TRUNCATE_CHARS) + "\n… [truncated]";
  }
  return out;
}

function normalizePath(p?: string): string | undefined {
  if (!p) return p;
  if (p.startsWith('/workspace')) {
    const rest = p.slice('/workspace'.length);
    p = rest.length ? rest : '/';
  }
  if (!p.startsWith('/')) p = '/' + p;
  return p;
}

async function ensureDirectory(vfs: VirtualFileSystem, projectId: string, path: string) {
  if (path === '/' || !path) return;
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  for (let i = 0; i < parts.length; i++) {
    cur = '/' + parts.slice(0, i + 1).join('/');
    try {
      // relies on createDirectory being idempotent
      await vfs.createDirectory(projectId, cur);
    } catch {
      // ignore
    }
  }
}

async function vfsShellExecute(
  vfs: VirtualFileSystem,
  projectId: string,
  cmd: string[],
  _opts: ShellOpts = {}
): Promise<ShellResult> {
  // Validate inputs
  if (!projectId || typeof projectId !== 'string') {
    return { stdout: '', stderr: 'Invalid project ID provided', exitCode: 2 };
  }
  
  if (!cmd || cmd.length === 0) {
    return { stdout: '', stderr: 'No command provided', exitCode: 2 };
  }
  
  // Filter out empty/undefined arguments
  const cleanCmd = cmd.filter(arg => arg !== undefined && arg !== null && arg !== '');
  if (cleanCmd.length === 0) {
    return { stdout: '', stderr: 'No valid command arguments provided', exitCode: 2 };
  }

  const [program, ...args] = cleanCmd;

  try {
    switch (program) {
      case 'ls': {
        // Support basic flags like -R (recursive). Ignore unknown flags gracefully.
        const flags = new Set<string>();
        const paths: string[] = [];
        for (const a of args) {
          if (a && a.startsWith('-')) flags.add(a);
          else if (a) paths.push(a);
        }
        const recursive = flags.has('-R') || flags.has('-r');
        const path = normalizePath(paths[0]) || '/';
        if (!recursive) {
          const files = await vfs.listDirectory(projectId, path);
          const lines = files.map(f => f.path).sort().join('\n');
          return { stdout: truncate(lines), stderr: '', exitCode: 0 };
        } else {
          const entries = await vfs.getAllFilesAndDirectories(projectId);
          const prefix = path === '/' ? '/' : (path.endsWith('/') ? path : path + '/');
          const res = entries
            .filter((e: any) => e.path === path || e.path.startsWith(prefix))
            .map((e: any) => e.path)
            .sort()
            .join('\n');
          return { stdout: truncate(res), stderr: '', exitCode: 0 };
        }
      }
      case 'tree': {
        // tree [path] [-L depth]
        let maxDepth = Infinity;
        let targetPath = '/';

        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a === '-L' && args[i + 1]) {
            maxDepth = parseInt(args[++i]) || Infinity;
          } else if (!a.startsWith('-')) {
            targetPath = a;
          }
        }

        const path = normalizePath(targetPath) || '/';
        const entries = await vfs.getAllFilesAndDirectories(projectId);
        const prefix = path === '/' ? '/' : (path.endsWith('/') ? path : path + '/');

        // Filter entries under the target path
        const relevantEntries = entries
          .filter((e: any) => e.path === path || e.path.startsWith(prefix))
          .map((e: any) => ({
            path: e.path,
            isDir: 'type' in e && e.type === 'directory'
          }));

        // Build tree structure
        const lines: string[] = [path];
        const sortedPaths = relevantEntries
          .filter(e => e.path !== path)
          .map(e => e.path)
          .sort();

        for (const entryPath of sortedPaths) {
          const relativePath = entryPath.slice(prefix.length);
          const depth = relativePath.split('/').filter(Boolean).length;

          if (depth > maxDepth) continue;

          const indent = '  '.repeat(depth - 1);
          const name = entryPath.split('/').pop() || entryPath;
          lines.push(`${indent}├── ${name}`);
        }

        return { stdout: truncate(lines.join('\n')), stderr: '', exitCode: 0 };
      }
      case 'cat': {
        const path = normalizePath(args[0]);
        if (!path) return { stdout: '', stderr: 'cat: missing file path', exitCode: 2 };
        if (path.startsWith('/-')) return { stdout: '', stderr: 'cat: invalid path (looks like an option). Use: cat /path/to/file', exitCode: 2 };
        const file = await vfs.readFile(projectId, path);
        if (typeof file.content !== 'string') {
          return { stdout: '', stderr: `cat: ${path}: binary or non-text file`, exitCode: 1 };
        }
        return { stdout: truncate(file.content), stderr: '', exitCode: 0 };
      }
      case 'head': {
        // head [-n lines] <file>
        let numLines = 10;
        let filePath = '';

        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a === '-n' && args[i + 1]) {
            numLines = parseInt(args[++i]) || 10;
          } else if (!a.startsWith('-')) {
            filePath = a;
          }
        }

        const path = normalizePath(filePath);
        if (!path) return { stdout: '', stderr: 'head: missing file path', exitCode: 2 };

        try {
          const file = await vfs.readFile(projectId, path);
          if (typeof file.content !== 'string') {
            return { stdout: '', stderr: `head: ${path}: binary file`, exitCode: 1 };
          }

          const lines = (file.content as string).split(/\r?\n/);
          const output = lines.slice(0, numLines).join('\n');
          return { stdout: truncate(output), stderr: '', exitCode: 0 };
        } catch (e: any) {
          return { stdout: '', stderr: `head: ${path}: ${e?.message || 'file not found'}`, exitCode: 1 };
        }
      }
      case 'tail': {
        // tail [-n lines] <file>
        let numLines = 10;
        let filePath = '';

        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a === '-n' && args[i + 1]) {
            numLines = parseInt(args[++i]) || 10;
          } else if (!a.startsWith('-')) {
            filePath = a;
          }
        }

        const path = normalizePath(filePath);
        if (!path) return { stdout: '', stderr: 'tail: missing file path', exitCode: 2 };

        try {
          const file = await vfs.readFile(projectId, path);
          if (typeof file.content !== 'string') {
            return { stdout: '', stderr: `tail: ${path}: binary file`, exitCode: 1 };
          }

          const lines = (file.content as string).split(/\r?\n/);
          const output = lines.slice(-numLines).join('\n');
          return { stdout: truncate(output), stderr: '', exitCode: 0 };
        } catch (e: any) {
          return { stdout: '', stderr: `tail: ${path}: ${e?.message || 'file not found'}`, exitCode: 1 };
        }
      }
      case 'grep': {
        // Supported: grep [-n] [-i] [-r] [-F] pattern path
        // -F: treat pattern as fixed string (literal) instead of regex
        const flags: Record<string, boolean> = { n: false, i: false, r: false, F: false };
        const fargs: string[] = [];
        for (const a of args) {
          if (a.startsWith('-')) {
            for (const ch of a.slice(1)) if (ch in flags) flags[ch] = true;
          } else {
            fargs.push(a);
          }
        }
        const pattern = fargs[0];
        const path = normalizePath(fargs[1]) || '/';
        if (!pattern) return { stdout: '', stderr: 'grep: missing pattern', exitCode: 2 };

        // Create regex - escape special chars if -F flag is used
        let regex: RegExp;
        if (flags.F) {
          // Escape special regex characters for literal string matching
          const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          regex = new RegExp(escaped, flags.i ? 'i' : '');
        } else {
          regex = new RegExp(pattern, flags.i ? 'i' : '');
        }

        const entries = await vfs.getAllFilesAndDirectories(projectId);
        const dirPrefix = path === '/' ? '/' : (path.endsWith('/') ? path : path + '/');
        const outLines: string[] = [];
        for (const e of entries) {
          if ('type' in e && e.type === 'directory') continue;
          const file = e as any;
          if (!file.path.startsWith(dirPrefix) && file.path !== path) continue;
          if (typeof file.content !== 'string') continue;
          const lines = (file.content as string).split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (regex.test(line)) {
              outLines.push(
                `${file.path}${flags.n ? ':' + (i + 1) : ''}:${line}`
              );
            }
          }
        }
        const output = outLines.join('\n');
        if (outLines.length === 0) {
          const location = path === '/' ? 'workspace root' : path;
          return { stdout: '', stderr: `grep: pattern "${pattern}" not found in ${location}`, exitCode: 1 };
        }
        return { stdout: truncate(output), stderr: '', exitCode: 0 };
      }
      case 'rg': {
        // ripgrep with context flags: rg [-n] [-i] [-C num] [-A num] [-B num] pattern [path]
        const flags: Record<string, any> = { n: true, i: false, C: 0, A: 0, B: 0 };
        const fargs: string[] = [];
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a.startsWith('-')) {
            if (a === '-n') flags.n = true;
            else if (a === '-i') flags.i = true;
            else if (a === '-C') { flags.C = parseInt(args[++i]) || 2; }
            else if (a === '-A') { flags.A = parseInt(args[++i]) || 2; }
            else if (a === '-B') { flags.B = parseInt(args[++i]) || 2; }
          } else {
            fargs.push(a);
          }
        }
        const pattern = fargs[0];
        const path = normalizePath(fargs[1]) || '/';
        if (!pattern) return { stdout: '', stderr: 'rg: missing pattern', exitCode: 2 };

        const regex = new RegExp(pattern, flags.i ? 'i' : '');
        const entries = await vfs.getAllFilesAndDirectories(projectId);
        const dirPrefix = path === '/' ? '/' : (path.endsWith('/') ? path : path + '/');
        const outLines: string[] = [];

        for (const e of entries) {
          if ('type' in e && e.type === 'directory') continue;
          const file = e as any;
          if (!file.path.startsWith(dirPrefix) && file.path !== path) continue;
          if (typeof file.content !== 'string') continue;

          const lines = (file.content as string).split(/\r?\n/);
          const matchedLines = new Set<number>();

          // Find all matches
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              matchedLines.add(i);
            }
          }

          if (matchedLines.size === 0) continue;

          // Add context lines
          const contextLines = new Set<number>();
          const beforeContext = flags.C || flags.B;
          const afterContext = flags.C || flags.A;

          for (const lineNum of matchedLines) {
            for (let j = Math.max(0, lineNum - beforeContext); j <= Math.min(lines.length - 1, lineNum + afterContext); j++) {
              contextLines.add(j);
            }
          }

          // Output with line numbers
          const sortedLines = Array.from(contextLines).sort((a, b) => a - b);
          if (outLines.length > 0) outLines.push(''); // Separator between files

          for (const lineNum of sortedLines) {
            const lineNumStr = flags.n ? `${lineNum + 1}:` : '';
            const isMatch = matchedLines.has(lineNum);
            outLines.push(`${file.path}:${lineNumStr}${lines[lineNum]}`);
          }
        }

        if (outLines.length === 0) {
          const location = path === '/' ? 'workspace root' : path;
          return { stdout: '', stderr: `rg: pattern "${pattern}" not found in ${location}`, exitCode: 1 };
        }
        return { stdout: truncate(outLines.join('\n')), stderr: '', exitCode: 0 };
      }
      case 'find': {
        // Supported: find <path> -name <pattern>; tolerate -maxdepth and -type flags
        let rootArg: string | undefined;
        let pattern: string | undefined;
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (!a) continue;
          if (a === '-name') { pattern = args[i + 1]; i++; continue; }
          if (a === '-maxdepth' || a === '-type') { i++; continue; }
          if (!a.startsWith('-') && !rootArg) rootArg = a;
        }
        const root = normalizePath(rootArg) || '/';
        const entries = await vfs.getAllFilesAndDirectories(projectId);
        const prefix = root === '/' ? '/' : (root.endsWith('/') ? root : root + '/');
        const toGlob = (s: string) => new RegExp('^' + s.replace(/[.+^${}()|\[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
        const regex = pattern ? toGlob(pattern) : null;
        const res = entries
          .filter((e: any) => e.path === root || e.path.startsWith(prefix))
          .map((e: any) => e.path)
          .filter(p => (regex ? regex.test(p.split('/').pop() || p) : true))
          .sort();
        return { stdout: truncate(res.join('\n')), stderr: '', exitCode: 0 };
      }
      case 'mkdir': {
        // Support: mkdir -p <path>
        const hasP = args.includes('-p');
        const raw = args[hasP ? args.indexOf('-p') + 1 : 0];
        const path = normalizePath(raw);
        if (!path) return { stdout: '', stderr: 'mkdir: missing path', exitCode: 2 };
        if (hasP) {
          await ensureDirectory(vfs, projectId, path);
        } else {
          await vfs.createDirectory(projectId, path);
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      case 'touch': {
        // touch <file> - create empty file or update timestamp
        const path = normalizePath(args[0]);
        if (!path) return { stdout: '', stderr: 'touch: missing file path', exitCode: 2 };

        try {
          // Check if file exists
          await vfs.readFile(projectId, path);
          // File exists, just return success (we don't update timestamps)
          return { stdout: '', stderr: '', exitCode: 0 };
        } catch {
          // File doesn't exist, create it with empty content
          try {
            await vfs.createFile(projectId, path, '');
            return { stdout: '', stderr: '', exitCode: 0 };
          } catch (e: any) {
            return { stdout: '', stderr: `touch: ${path}: ${e?.message || 'cannot create file'}`, exitCode: 1 };
          }
        }
      }
      case 'rm': {
        // Enhanced rm command: rm [-rfv] <file/dir...>
        // Parse flags including combined flags like -rf, -rfv
        let recursive = false;
        let force = false;
        let verbose = false;
        const targets: string[] = [];
        
        for (const arg of args) {
          if (arg && arg.startsWith('-')) {
            // Handle combined flags like -rf, -rfv
            if (arg.includes('r') || arg.includes('R')) recursive = true;
            if (arg.includes('f')) force = true;
            if (arg.includes('v')) verbose = true;
          } else if (arg) {
            targets.push(arg);
          }
        }
        
        if (targets.length === 0) return { stdout: '', stderr: 'rm: missing operand', exitCode: 2 };
        
        let hadError = false;
        const verboseOutput: string[] = [];
        
        for (const target of targets) {
          const path = normalizePath(target);
          if (!path) {
            if (!force) hadError = true;
            continue;
          }
          
          try {
            // Try to delete as file first
            await vfs.deleteFile(projectId, path);
            if (verbose) verboseOutput.push(`removed '${path}'`);
          } catch {
            // If not a file, try as directory
            if (recursive) {
              try {
                await vfs.deleteDirectory(projectId, path);
                if (verbose) verboseOutput.push(`removed directory '${path}'`);
              } catch {
                if (!force) {
                  hadError = true;
                  if (verbose) verboseOutput.push(`rm: cannot remove '${path}': No such file or directory`);
                }
              }
            } else {
              if (!force) {
                hadError = true;
                if (verbose) verboseOutput.push(`rm: cannot remove '${path}': Is a directory (use -r to remove directories)`);
              }
            }
          }
        }
        
        const stdout = verbose ? verboseOutput.join('\n') : '';
        const stderr = hadError && !verbose ? 'rm: some paths could not be removed' : '';
        return { stdout: truncate(stdout), stderr, exitCode: hadError ? 1 : 0 };
      }
      case 'mv': {
        const [rold, rnew] = args;
        const oldPath = normalizePath(rold);
        const newPath = normalizePath(rnew);
        if (!oldPath || !newPath) return { stdout: '', stderr: 'mv: missing operands', exitCode: 2 };
        // Try file move
        try {
          await vfs.renameFile(projectId, oldPath, newPath);
          return { stdout: '', stderr: '', exitCode: 0 };
        } catch {
          // Try directory move
          await vfs.renameDirectory(projectId, oldPath, newPath);
          return { stdout: '', stderr: '', exitCode: 0 };
        }
      }
      case 'cp': {
        // Support: cp <src> <dst> | cp -r <srcDir> <dstDir>
        const recursive = args.includes('-r');
        const filtered = args.filter(a => a !== '-r');
        let [src, dst] = filtered;
        src = normalizePath(src) as string;
        dst = normalizePath(dst) as string;
        if (!src || !dst) return { stdout: '', stderr: 'cp: missing operands', exitCode: 2 };
        // Attempt file copy
        try {
          const file = await vfs.readFile(projectId, src);
          const content = typeof file.content === 'string' ? file.content : file.content;
          try {
            await vfs.createFile(projectId, dst, content as any);
          } catch {
            await vfs.updateFile(projectId, dst, content as any);
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        } catch {
          if (!recursive) {
            return { stdout: '', stderr: 'cp: -r required for directories', exitCode: 1 };
          }
          // Directory copy: copy all files under src prefix
          const entries = await vfs.getAllFilesAndDirectories(projectId);
          const srcPrefix = src.endsWith('/') ? src : src + '/';
          for (const e2 of entries) {
            if ('type' in e2 && e2.type === 'directory') continue;
            const file = e2 as any;
            if (file.path === src || file.path.startsWith(srcPrefix)) {
              const rel = file.path.slice(src.length);
              const target = (dst.endsWith('/') ? dst.slice(0, -1) : dst) + rel;
              await ensureDirectory(vfs, projectId, target.split('/').slice(0, -1).join('/'));
              const content = typeof file.content === 'string' ? file.content : file.content;
              try {
                await vfs.createFile(projectId, target, content as any);
              } catch {
                await vfs.updateFile(projectId, target, content as any);
              }
            }
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        }
      }
      case 'echo': {
        // Support: echo text or echo "text" > /file.txt
        const redirectIndex = args.indexOf('>');

        if (redirectIndex === -1) {
          // No redirection, just output to stdout
          return { stdout: truncate(args.join(' ')), stderr: '', exitCode: 0 };
        }

        // Handle redirection: echo text > /file.txt
        const content = args.slice(0, redirectIndex).join(' ');
        const targetFile = args[redirectIndex + 1];
        const path = normalizePath(targetFile);

        if (!path) {
          return { stdout: '', stderr: 'echo: missing file path after >', exitCode: 2 };
        }

        try {
          // Ensure parent directory exists
          const dirPath = path.split('/').slice(0, -1).join('/') || '/';
          if (dirPath !== '/') {
            await ensureDirectory(vfs, projectId, dirPath);
          }

          // Create or overwrite the file
          try {
            await vfs.createFile(projectId, path, content);
          } catch {
            await vfs.updateFile(projectId, path, content);
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        } catch (e: any) {
          return { stdout: '', stderr: `echo: ${path}: ${e?.message || 'cannot write file'}`, exitCode: 1 };
        }
      }
      default: {
        const bashHint = program === 'bash' ? `
Don't use "bash" as a command - call the shell tool directly with your command.
Wrong: {"cmd": ["bash", "-c", "ls -la"]}
Right: {"cmd": ["ls", "-la"]}
` : '';

        return {
          stdout: '',
          stderr: `${program}: command not found${bashHint}

Supported commands: ls, tree, cat, head, tail, rg, grep, find, mkdir, touch, rm, mv, cp, echo

Correct shell tool usage:
  {"cmd": ["ls", "/"]}                        - List files
  {"cmd": ["ls", "-R", "/"]}                  - List files recursively
  {"cmd": ["tree", "/", "-L", "2"]}           - Show directory tree (max depth 2)
  {"cmd": ["cat", "/file.txt"]}               - Read entire file
  {"cmd": ["head", "-n", "20", "/file.txt"]}  - Read first 20 lines
  {"cmd": ["tail", "-n", "20", "/file.txt"]}  - Read last 20 lines
  {"cmd": ["rg", "-C", "3", "pattern", "/"]}  - Search with 3 lines context (recommended)
  {"cmd": ["rg", "-A", "2", "-B", "1", "pattern"]} - Search with custom context
  {"cmd": ["grep", "-n", "pattern", "/file.txt"]} - Search with line numbers
  {"cmd": ["grep", "-F", "literal", "/file.txt"]} - Search literal string
  {"cmd": ["find", "/", "-name", "*.js"]}     - Find files by name
  {"cmd": ["mkdir", "-p", "/path/to/dir"]}    - Create directory (with parents)
  {"cmd": ["touch", "/file.txt"]}             - Create empty file
  {"cmd": ["rm", "-rf", "/dirname"]}          - Delete directory recursively
  {"cmd": ["mv", "/old.txt", "/new.txt"]}     - Move/rename files
  {"cmd": ["cp", "-r", "/src", "/dest"]}      - Copy files/directories
  {"cmd": ["echo", "Hello World"]}            - Output text
  {"cmd": ["echo", "content", ">", "/file.txt"]} - Write text to file

Note: Use json_patch tool for complex file editing. Use rg (ripgrep) instead of grep for better context.`,
          exitCode: 127
        };
      }
    }
  } catch (e: any) {
    return { stdout: '', stderr: e?.message || String(e), exitCode: 1 };
  }
}

// Create a global instance that can be imported
export const vfsShell = {
  execute: async (projectId: string, cmd: string[]): Promise<{ success: boolean; stdout?: string; stderr?: string }> => {
    const vfs = new VirtualFileSystem();
    await vfs.init();
    const result = await vfsShellExecute(vfs, projectId, cmd);
    return {
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr
    };
  }
};
