import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getPolicyTemplate,
  listPolicyTemplateNames,
  normalizePolicyTemplateName,
} from '../src/policy-templates.js';

describe('policy templates', () => {
  it('lists stable template names', () => {
    assert.deepEqual(listPolicyTemplateNames(), ['default', 'team', 'strict']);
  });

  it('keeps team and strict templates aligned with documented examples', () => {
    for (const templateName of ['team', 'strict'] as const) {
      const example = JSON.parse(readFileSync(
        join(process.cwd(), 'docs', 'examples', 'policies', `${templateName}.json`),
        'utf-8',
      ));
      assert.deepEqual(getPolicyTemplate(templateName), example);
    }
  });

  it('rejects unknown templates', () => {
    assert.throws(
      () => normalizePolicyTemplateName('unknown'),
      /Unknown policy template/,
    );
  });
});
