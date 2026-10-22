import { test } from 'node:test';
import assert from 'node:assert/strict';
import GridGeometry from './GridGeometry.js';

test('offscreen cell bounds include full-sheet widths, multiline heights and tab stops', () => {
	const cells = [['', ''], ['a\r\nb\nc', 'abcd\tx'], ['1234567890\n', '']].map(row => row.map(text => ({ text })));
	const grid = new GridGeometry(cells, text => text.length * 10);
	assert.deepEqual(grid.cellRect(2, 1), { top: 101, bottom: 124, left: 195, right: 290 });
	assert.deepEqual(grid.visible(21, 105, 103, 185), { top: 1, bottom: 2, left: 1, right: 1 });
	assert.equal(grid.cellRect(3, 0), null);
});

test('windowed segments preserve all space, exact boundaries and distant chart anchors', () => {
	const cells = Array.from({ length: 2105 }, () => [{ text: '' }]);
	cells[4][0].value = { kind: 'chart' };
	const grid = new GridGeometry(cells, text => text.length * 10);
	const segments = grid.segments(grid.rows, 2100 * 21, 42, grid.chartRows, 0);
	assert.deepEqual(segments.filter(segment => !segment.gap).map(segment => segment.index), [4, 2100, 2101, 2102]);
	assert.equal(segments.reduce((size, segment) => size + segment.size, 0), 2105 * 21);
	assert.equal(segments.reduce((count, segment) => count + segment.count, 0), 2105);
	assert.ok(segments.every(segment => segment.count <= 1000));
});
