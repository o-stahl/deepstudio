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
      case 'rmdir': {
        // rmdir command for removing empty directories
        const targets: string[] = [];
        let verbose = false;
        
        for (const arg of args) {
          if (arg === '-v' || arg === '--verbose') {
            verbose = true;
          } else if (arg && !arg.startsWith('-')) {
            targets.push(arg);
          }
        }
        
        if (targets.length === 0) return { stdout: '', stderr: 'rmdir: missing operand', exitCode: 2 };
        
        let hadError = false;
        const verboseOutput: string[] = [];
        
        for (const target of targets) {
          const path = normalizePath(target);
          if (!path) {
            hadError = true;
            continue;
          }
          
          try {
            // Check if directory is empty by listing its contents
            const contents = await vfs.listDirectory(projectId, path);
            if (contents.length > 0) {
              hadError = true;
              if (verbose) verboseOutput.push(`rmdir: failed to remove '${path}': Directory not empty`);
            } else {
              await vfs.deleteDirectory(projectId, path);
              if (verbose) verboseOutput.push(`rmdir: removing directory, '${path}'`);
            }
          } catch {
            hadError = true;
            if (verbose) verboseOutput.push(`rmdir: failed to remove '${path}': No such file or directory`);
          }
        }
        
        const stdout = verbose ? verboseOutput.join('\n') : '';
        const stderr = hadError && !verbose ? 'rmdir: failed to remove one or more directories' : '';
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
        // Disallow file redirection; edits must go through json_patch
        if (args.includes('>') || args.includes('>>')) {
          return { stdout: '', stderr: 'echo: redirection is not supported in this environment. Use json_patch to edit files.', exitCode: 2 };
        }
        return { stdout: truncate(args.join(' ')), stderr: 'echo prints to stdout only. To modify files, use json_patch.', exitCode: 1 };
      }
      case 'nl': {
        // Number lines: nl [-ba] <file>
        let showAll = false;
        let filePath = '';
        
        for (const arg of args) {
          if (arg === '-ba') {
            showAll = true;
          } else if (!arg.startsWith('-')) {
            filePath = arg;
          }
        }
        
        const path = normalizePath(filePath);
        if (!path) return { stdout: '', stderr: 'nl: missing file path', exitCode: 2 };
        
        try {
          const file = await vfs.readFile(projectId, path);
          if (typeof file.content !== 'string') {
            return { stdout: '', stderr: `nl: ${path}: binary file`, exitCode: 1 };
          }
          
          const lines = (file.content as string).split(/\r?\n/);
          const numberedLines = lines.map((line, index) => {
            const lineNum = String(index + 1).padStart(6, ' ');
            return `${lineNum}\t${line}`;
          });
          
          return { stdout: truncate(numberedLines.join('\n')), stderr: '', exitCode: 0 };
        } catch (e: any) {
          return { stdout: '', stderr: `nl: ${path}: ${e?.message || 'file not found'}`, exitCode: 1 };
        }
      }
      case 'sed': {
        // Support both substitution and line printing modes (non-persisting preview only)
        if (args.length === 0) {
          return { stdout: '', stderr: 'sed: usage: sed "s/pat/repl/g" <file> or sed -n "1,80p" <file>', exitCode: 2 };
        }
        
        // Check for -n flag (quiet mode)
        let quietMode = false;
        let scriptIndex = 0;
        let pathIndex = 1;
        
        if (args[0] === '-n') {
          quietMode = true;
          scriptIndex = 1;
          pathIndex = 2;
        }
        
        const script = args[scriptIndex];
        const path = args[pathIndex];
        
        if (!script || !path) {
          return { stdout: '', stderr: 'sed: usage: sed "s/pat/repl/g" <file> or sed -n "1,80p" <file>', exitCode: 2 };
        }
        
        // Handle line range printing (like "1,80p")
        const lineRangeMatch = script.match(/^(\d+),(\d+)p$/);
        if (lineRangeMatch) {
          const startLine = parseInt(lineRangeMatch[1]);
          const endLine = parseInt(lineRangeMatch[2]);
          
          const file = await vfs.readFile(projectId, path);
          if (typeof file.content !== 'string') return { stdout: '', stderr: 'sed: binary file', exitCode: 1 };
          
          const lines = (file.content as string).split('\n');
          const selectedLines = lines.slice(startLine - 1, endLine); // Convert to 0-based indexing
          return { stdout: truncate(selectedLines.join('\n')), stderr: 'sed output is preview-only. To save, use json_patch.', exitCode: 0 };
        }
        
        // Handle single line printing (like "80p")
        const singleLineMatch = script.match(/^(\d+)p$/);
        if (singleLineMatch) {
          const lineNum = parseInt(singleLineMatch[1]);
          
          const file = await vfs.readFile(projectId, path);
          if (typeof file.content !== 'string') return { stdout: '', stderr: 'sed: binary file', exitCode: 1 };
          
          const lines = (file.content as string).split('\n');
          if (lineNum <= 0 || lineNum > lines.length) {
            return { stdout: '', stderr: `sed: line ${lineNum} out of range`, exitCode: 1 };
          }
          return { stdout: truncate(lines[lineNum - 1]), stderr: 'sed output is preview-only. To save, use json_patch.', exitCode: 0 };
        }
        
        // Handle substitution (original functionality)
        const substitutionMatch = script.match(/^s\/(.*)\/(.*)\/(g?)$/);
        if (substitutionMatch) {
          const [, pat, repl] = substitutionMatch;
          const file = await vfs.readFile(projectId, path);
          if (typeof file.content !== 'string') return { stdout: '', stderr: 'sed: binary file', exitCode: 1 };
          const re = new RegExp(pat, 'g');
          const out = (file.content as string).replace(re, repl);
          return { stdout: truncate(out), stderr: 'sed output is preview-only. To save, use json_patch.', exitCode: quietMode ? 0 : 1 };
        }
        
        return { stdout: '', stderr: 'sed: supported formats: "s/pat/repl/g", "1,80p", "80p". Use json_patch for file changes.', exitCode: 2 };
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

Supported commands: ls, cat, grep, find, mkdir, rm, rmdir, mv, cp, echo, nl, sed

Correct shell tool usage:
  {"cmd": ["ls", "/"]}                     - List files
  {"cmd": ["cat", "/file.txt"]}            - Read file content  
  {"cmd": ["grep", "pattern", "/file.txt"]} - Search with regex
  {"cmd": ["grep", "-F", "literal", "/file.txt"]} - Search literal string
  {"cmd": ["find", "/", "-name", "*.js"]}  - Find files by name
  {"cmd": ["mkdir", "/dirname"]}           - Create directory
  {"cmd": ["rm", "/file.txt"]}             - Delete file
  {"cmd": ["rm", "-r", "/dirname"]}        - Delete directory recursively
  {"cmd": ["rm", "-rf", "/dirname"]}       - Force delete directory
  {"cmd": ["rm", "-rfv", "/dir1", "/dir2"]} - Verbose force delete multiple
  {"cmd": ["rmdir", "/empty-dir"]}         - Remove empty directory
  {"cmd": ["rmdir", "-v", "/dir1"]}        - Remove empty directory (verbose)
  {"cmd": ["mv", "/old.txt", "/new.txt"]}  - Move/rename files
  {"cmd": ["cp", "/file.txt", "/copy.txt"]} - Copy files
  {"cmd": ["echo", "text"]}                - Output text (read-only)
  {"cmd": ["nl", "/file.txt"]}             - Show file with line numbers
  {"cmd": ["sed", "s/old/new/g", "/file.txt"]} - Preview text replacement

Note: File edits require the json_patch tool, not shell commands.`, 
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
