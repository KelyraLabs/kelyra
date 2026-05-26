import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { myersDiff, renderDiff } from '../src/diff.js';

describe('myersDiff', () => {
  it('identifies identical strings', () => {
    const a = ['line1', 'line2'];
    const b = ['line1', 'line2'];
    const result = myersDiff(a, b);
    assert.equal(result.every(r => r.op === 'keep'), true);
    assert.equal(result.length, 2);
  });

  it('identifies a single addition', () => {
    const a = ['line1'];
    const b = ['line1', 'line2'];
    const result = myersDiff(a, b);
    assert.deepEqual(result, [
      { op: 'keep', val: 'line1' },
      { op: 'add', val: 'line2' }
    ]);
  });

  it('identifies a single deletion', () => {
    const a = ['line1', 'line2'];
    const b = ['line1'];
    const result = myersDiff(a, b);
    assert.deepEqual(result, [
      { op: 'keep', val: 'line1' },
      { op: 'remove', val: 'line2' }
    ]);
  });

  it('identifies a modification (remove + add)', () => {
    const a = ['line2'];
    const b = ['line2-changed'];
    const result = myersDiff(a, b);
    assert.deepEqual(result, [
      { op: 'remove', val: 'line2' },
      { op: 'add', val: 'line2-changed' }
    ]);
  });

  it('handles empty sequences', () => {
    const result = myersDiff([], ['new']);
    assert.deepEqual(result, [{ op: 'add', val: 'new' }]);
  });
});

describe('renderDiff', () => {
  it('returns informative message for identical text', () => {
    const result = renderDiff('same', 'same');
    assert.ok(result.includes('No changes detected'));
  });

  it('renders a colored diff string', () => {
    const result = renderDiff('old', 'new');
    // Check for core content while allowing for ANSI escape codes
    assert.match(result, /-.*old/);
    assert.match(result, /\+.*new/);
    assert.ok(result.includes('│')); // Line numbering column (box-drawing)
  });

  it('collapses large unchanged blocks', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line${i + 1}`);
    const oldText = lines.join('\n');
    // Change lines 5 and 45 to create a large unchanged gap between them
    const modified = [...lines];
    modified[4] = 'CHANGED-5';
    modified[44] = 'CHANGED-45';
    const newText = modified.join('\n');
    const result = renderDiff(oldText, newText);
    // Should have a collapse separator for the ~35 unchanged lines in the middle
    assert.ok(result.includes('unchanged lines'), 'Should show collapsed indicator');
  });

  it('shows diff stats footer', () => {
    const result = renderDiff('old\nline', 'new\nline');
    // Should show +1 and -1 stats
    assert.ok(result.includes('+1'), 'Should show addition count');
    assert.ok(result.includes('-1'), 'Should show deletion count');
  });
});
