// Reference: governance/GD-M38-1.md — Decision 18/19 (internal-service-only
// architecture; no existing controller or workflow may call M38 services;
// runtime non-activation boundary).
//
// This is the structural proof those Decisions require: it reads the REAL
// source files under apps/api/src (via fs, following real `import ... from`
// statements — never mocked, never simulated) and builds the actual internal
// module import graph, then proves by graph reachability — not by running
// any request, guard, or service method — that:
//   (a) no import chain connects DecisionCaseService/ApprovalService to
//       RolesGuard, CapabilityGuard, JwtStrategy, or AuthService in either
//       direction;
//   (b) no existing controller file imports either M38 service;
//   (c) no file under src/decisions declares an HTTP route decorator;
//   (d) decisions.module.ts registers no controllers.
//
// Mirrors elevation-session.structural.spec.ts's exact technique.

import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..'); // apps/api/src

const DECISION_CASE_SERVICE_FILE = path.resolve(__dirname, 'decision-case.service.ts');
const APPROVAL_SERVICE_FILE = path.resolve(__dirname, 'approval.service.ts');
const DECISIONS_MODULE_FILE = path.resolve(__dirname, 'decisions.module.ts');

const FORBIDDEN_TARGETS: Record<string, string> = {
  RolesGuard: path.resolve(SRC_ROOT, 'identity', 'roles.guard.ts'),
  CapabilityGuard: path.resolve(SRC_ROOT, 'identity', 'capability.guard.ts'),
  JwtStrategy: path.resolve(SRC_ROOT, 'identity', 'jwt.strategy.ts'),
  AuthService: path.resolve(SRC_ROOT, 'identity', 'auth.service.ts'),
};

const IMPORT_PATTERN = /import\s+(?:type\s+)?(?:[\w*{}\s,]+)\s+from\s+['"]([^'"]+)['"]/g;
const ROUTE_DECORATOR_PATTERN = /@(Get|Post|Put|Patch|Delete|Controller)\s*\(/;

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

describe('M38 decisions module — structural non-activation proof (GD-M38-1 Decision 18/19)', () => {
  const allFiles = listSourceFiles(SRC_ROOT);
  const graph = buildImportGraph(allFiles);
  const controllerFiles = allFiles.filter((f) => f.endsWith('.controller.ts'));
  const decisionsFiles = allFiles.filter((f) => path.dirname(f) === path.resolve(SRC_ROOT, 'decisions'));

  it('sanity: the source tree scan found the M38 service files and at least one existing controller', () => {
    expect(fs.existsSync(DECISION_CASE_SERVICE_FILE)).toBe(true);
    expect(fs.existsSync(APPROVAL_SERVICE_FILE)).toBe(true);
    expect(controllerFiles.length).toBeGreaterThan(0);
  });

  it.each(Object.entries(FORBIDDEN_TARGETS))(
    'no import chain from DecisionCaseService reaches %s',
    (_name, targetFile) => {
      expect(isReachable(graph, DECISION_CASE_SERVICE_FILE, targetFile)).toBe(false);
    },
  );

  it.each(Object.entries(FORBIDDEN_TARGETS))(
    'no import chain from %s reaches DecisionCaseService',
    (_name, targetFile) => {
      expect(isReachable(graph, targetFile, DECISION_CASE_SERVICE_FILE)).toBe(false);
    },
  );

  it.each(Object.entries(FORBIDDEN_TARGETS))(
    'no import chain from ApprovalService reaches %s',
    (_name, targetFile) => {
      expect(isReachable(graph, APPROVAL_SERVICE_FILE, targetFile)).toBe(false);
    },
  );

  it.each(Object.entries(FORBIDDEN_TARGETS))(
    'no import chain from %s reaches ApprovalService',
    (_name, targetFile) => {
      expect(isReachable(graph, targetFile, APPROVAL_SERVICE_FILE)).toBe(false);
    },
  );

  it('DecisionCaseService/ApprovalService code (excluding comments) never references RolesGuard, CapabilityGuard, JwtStrategy, or AuthService by name', () => {
    for (const file of [DECISION_CASE_SERVICE_FILE, APPROVAL_SERVICE_FILE]) {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      for (const name of Object.keys(FORBIDDEN_TARGETS)) {
        expect(code.includes(name)).toBe(false);
      }
    }
  });

  it('no existing controller file imports DecisionCaseService or ApprovalService (GD-M38-1 Decision 19)', () => {
    for (const controllerFile of controllerFiles) {
      expect(isReachable(graph, controllerFile, DECISION_CASE_SERVICE_FILE)).toBe(false);
      expect(isReachable(graph, controllerFile, APPROVAL_SERVICE_FILE)).toBe(false);
    }
  });

  it('no existing controller file (excluding comments) references DecisionCaseService or ApprovalService by name', () => {
    for (const controllerFile of controllerFiles) {
      const code = stripComments(fs.readFileSync(controllerFile, 'utf8'));
      expect(code.includes('DecisionCaseService')).toBe(false);
      expect(code.includes('ApprovalService')).toBe(false);
    }
  });

  it('no file under src/decisions declares an HTTP route or controller decorator', () => {
    for (const file of decisionsFiles) {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      expect(ROUTE_DECORATOR_PATTERN.test(code)).toBe(false);
    }
  });

  it('decisions.module.ts declares no controllers array', () => {
    const code = stripComments(fs.readFileSync(DECISIONS_MODULE_FILE, 'utf8'));
    expect(/controllers\s*:/.test(code)).toBe(false);
  });

  it('no file under src/decisions imports anything from a .controller.ts file', () => {
    for (const file of decisionsFiles) {
      const content = fs.readFileSync(file, 'utf8');
      let match: RegExpExecArray | null;
      IMPORT_PATTERN.lastIndex = 0;
      while ((match = IMPORT_PATTERN.exec(content)) !== null) {
        expect(match[1]!.includes('.controller')).toBe(false);
      }
    }
  });

  it('recruiting (offer/application) and workforce (employee) controllers remain fully disconnected from the M38 decisions services', () => {
    const recruitingAndWorkforceControllers = controllerFiles.filter(
      (f) => f.includes(`${path.sep}recruiting${path.sep}`) || f.includes(`${path.sep}workforce${path.sep}`),
    );
    expect(recruitingAndWorkforceControllers.length).toBeGreaterThan(0);
    for (const controllerFile of recruitingAndWorkforceControllers) {
      expect(isReachable(graph, controllerFile, DECISION_CASE_SERVICE_FILE)).toBe(false);
      expect(isReachable(graph, controllerFile, APPROVAL_SERVICE_FILE)).toBe(false);
    }
  });
});
