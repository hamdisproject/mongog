import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadYaml } from './helpers/release.js';

describe('PR quality workflow', () => {
  const workflowPath = path.resolve(process.cwd(), '.github', 'workflows', 'quality.yml');
  const workflow = readFileSync(workflowPath, 'utf8');
  const parsed = loadYaml(workflow) as { jobs: Record<string, unknown> };

  it('runs static, area unit, and area integration checks', () => {
    expect(Object.keys(parsed.jobs)).toEqual(['static', 'unit', 'integration', 'e2e-package', 'e2e']);
    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain("- main");
    expect(workflow).toContain('npm run typecheck');
    expect(workflow).toContain('npm run lint');
    expect(workflow).toContain('area: [main, runtime, renderer, analysis, shared, release, sql]');
    expect(workflow).toContain('npm run test:unit:${{ matrix.area }}');
    expect(workflow).toContain('area: [engine, collections, data, admin]');
    expect(workflow).toContain('npm run test:integ:${{ matrix.area }}');
    expect(workflow.match(/~\/\.cache\/mongodb-binaries/gu)).toHaveLength(2);
  });

  it('packages Linux once and fans out six single-worker E2E areas', () => {
    expect(workflow.match(/npm run package --/gu)).toHaveLength(1);
    expect(workflow).toContain('tar -C out -czf mongog-linux-x64.tar.gz MongoG-linux-x64');
    expect(workflow).toContain('actions/upload-artifact@v4');
    expect(workflow).toContain('compression-level: 0');
    expect(workflow).toContain('needs: e2e-package');
    expect(workflow).toContain('area: [app, connections, query, collections, workflows, updates]');
    expect(workflow).toContain('xvfb-run -a npm run test:e2e:${{ matrix.area }}');
    expect(workflow).toContain('MONGOG_E2E_EXECUTABLE:');
    expect(workflow).toContain('if: failure()');
    expect(workflow).not.toContain('retry');
  });
});
