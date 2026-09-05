// Reference: governance/GD-M37-1.md — Decision 17 (proof that elevation
// cannot affect runtime authorization)
//
// This is the structural proof Decision 17 requires: it reads the REAL
// source files under apps/api/src (via fs, following real `import ... from`
// statements — never mocked, never simulated) and builds the actual internal
// module import graph, then proves by graph reachability — not by running
// any request, guard, or service method — that no import chain connects
// ElevationSessionService to RolesGuard, CapabilityGuard, JwtStrategy, or
// AuthService in either direction. A behavioral test that merely happens not
// to exercise such a path would not satisfy Decision 17; this test would
// fail the moment a single `import` statement created that connection,
// regardless of whether any test ever calls the resulting code.
//
// Mirrors capability-parity.spec.ts's own technique of reading real metadata
// directly off real files rather than asserting against a hand-maintained
// model of what the code is assumed to do.

import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..'); // apps/api/src

const ELEVATION_SERVICE_FILE = path.resolve(__dirname, 'elevation-session.service.ts');
const FORBIDDEN_TARGETS: Record<string, string> = {
  RolesGuard: path.resolve(__dirname, 'roles.guard.ts'),
  CapabilityGuard: path.resolve(__dirname, 'capability.guard.ts'),
  JwtStrategy: path.resolve(__dirname, 'jwt.strategy.ts'),
  AuthService: path.resolve(__dirname, 'auth.service.ts'),
};

const IMPORT_PATTERN = /import\s+(?:type\s+)?(?:[\w*{}\s,]+)\s+from\s+['"]([^'"]+)['"]/g;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

function resolveRelativeImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null; // external package — not part of the internal graph

  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [`${base}.ts`, path.join(base, 'index.ts')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function buildImportGraph(files: string[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const edges = new Set<string>();
    let match: RegExpExecArray | null;
    IMPORT_PATTERN.lastIndex = 0;
    while ((match = IMPORT_PATTERN.exec(content)) !== null) {
      const resolved = resolveRelativeImport(file, match[1]!);
      if (resolved) edges.add(resolved);
    }
    graph.set(file, edges);
  }
  return graph;
}

// Strips // line comments and /* */ block comments so the textual
// cross-reference checks below scan only real code — a doc comment that
// legitimately *describes* the non-reachability guarantee (by naming the
// very guards it documents disconnection from) must not itself trip a
// "references it by name" check. The graph-reachability tests above are the
// reliable proof (real import statements only); this textual check exists
// only to catch a non-import usage (e.g. a runtime require() or a bare
// identifier reference) that the import-parser would miss.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function isReachable(graph: Map<string, Set<string>>, from: string, to: string): boolean {
  const visited = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of graph.get(current) ?? []) {
      if (next === to) return true;
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

describe('ElevationSessionService — structural non-reachability proof (GD-M37-1 Decision 17)', () => {
  const allFiles = listSourceFiles(SRC_ROOT);
  const graph = buildImportGraph(allFiles);

  it('sanity: the source tree scan found the 5 files under test', () => {
    expect(fs.existsSync(ELEVATION_SERVICE_FILE)).toBe(true);
    for (const target of Object.values(FORBIDDEN_TARGETS)) {
      expect(fs.existsSync(target)).toBe(true);
    }
  });

  it.each(Object.entries(FORBIDDEN_TARGETS))(
    'no import chain from ElevationSessionService reaches %s',
    (_name, targetFile) => {
      expect(isReachable(graph, ELEVATION_SERVICE_FILE, targetFile)).toBe(false);
    },
  );

  it.each(Object.entries(FORBIDDEN_TARGETS))(
    'no import chain from %s reaches ElevationSessionService',
    (_name, targetFile) => {
      expect(isReachable(graph, targetFile, ELEVATION_SERVICE_FILE)).toBe(false);
    },
  );

  it('ElevationSessionService code (excluding comments) never references RolesGuard, CapabilityGuard, JwtStrategy, or AuthService by name', () => {
    const code = stripComments(fs.readFileSync(ELEVATION_SERVICE_FILE, 'utf8'));
    for (const name of Object.keys(FORBIDDEN_TARGETS)) {
      expect(code.includes(name)).toBe(false);
    }
  });

  it('none of RolesGuard/CapabilityGuard/JwtStrategy/AuthService code (excluding comments) references ElevationSessionService by name', () => {
    for (const targetFile of Object.values(FORBIDDEN_TARGETS)) {
      const code = stripComments(fs.readFileSync(targetFile, 'utf8'));
      expect(code.includes('ElevationSessionService')).toBe(false);
    }
  });
});
