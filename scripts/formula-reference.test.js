import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeFormulaReference } from './formula-reference.js';
import { formulaCatalog, methodTypes } from '../src/classes/FormulaCatalog.js';
import { FormulaType } from '../src/classes/FormulaTypes.js';
import { compileConditionalRule } from '../src/classes/ConditionalFormatting.js';
import SheetManager from '../src/classes/SheetManager.js';

test('the generated reference is current and indexes every callable and referenced type', async () => {
	await writeFormulaReference(true);
	const reference = readFileSync(new URL('../docs/formulas.md', import.meta.url), 'utf8');
	const definitions = [...Object.entries(formulaCatalog), ...methodTypes.flatMap(type => Object.entries(type.methods).map(([name, definition]) => [`${type.name}.${name}`, definition]))];
	for (const [name, definition] of definitions) {
		assert.ok(reference.includes(`### ${name}\n`), name);
		assert.ok(definition.returns instanceof FormulaType, name);
		assert.ok(definition.description.trim(), name);
		for (const overload of definition.overloads ?? [definition]) {
			assert.ok(overload.returns instanceof FormulaType, name);
			assert.ok(overload.parameters.every(param => param.type instanceof FormulaType), name);
		}
	}
	for (const match of reference.matchAll(/\]\(#(type-[^)]+)\)/g)) assert.ok(reference.includes(`id="${match[1]}"`), match[1]);
});

test('every native reference example executes with the documented formula syntax', () => {
	const sheet = new SheetManager();
	sheet.rows = Array.from({ length: 20 }, () => Array(30).fill(''));
	for (let row = 0; row < 4; row++) { sheet.rows[row][0] = String(row + 1); sheet.rows[row][1] = String((row + 1) * 10); }
	const definitions = [...Object.values(formulaCatalog).filter(definition => !definition.library), ...methodTypes.flatMap(type => Object.values(type.methods))];
	for (const definition of definitions) for (const example of definition.examples) {
		if (/^CF\(/.test(example)) assert.ok(compileConditionalRule('=' + example).range, example);
		else {
			sheet.rows[0][10] = '=' + example;
			sheet.getValue(0, 10);
			assert.equal(sheet.cellErrors.get('0:10'), undefined, example);
		}
	}
});
