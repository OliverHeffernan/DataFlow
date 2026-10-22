import test from 'node:test';
import assert from 'node:assert/strict';
import { FormulaType, AnyType, NumberType, TextType, BooleanType, ArrayType, RecordType, StreamType, OptionalType, ChartType, LambdaType, typeOf, typeParameter, parameter, defineFunction, resultType } from './FormulaTypes.js';
import { evaluateFormula } from './FormulaFunctions.js';

test('formula types describe, validate and present scalar, record, table and expression-only values', () => {
	const record = evaluateFormula('rowstream(VSTACK("age",23)).findFirst().map(a->{years:a.age,name:"John"})', 0, 0, { streamExpression: true }).value;
	assert.equal(typeOf(record).base, RecordType);
	assert.equal(RecordType.of({ years: NumberType, name: TextType }).accepts(record), true);
	assert.equal(RecordType.of({ years: TextType, name: TextType }).accepts(record), false);
	assert.equal(RecordType.of({ years: NumberType }).accepts(record), false);
	assert.deepEqual(typeOf(record).present(record), { kind: 'record', value: record });
	assert.deepEqual(NumberType.present(17), { kind: 'scalar', value: 17 });
	assert.equal(ArrayType.of(NumberType).accepts([[1, 2], [3, 4]]), true);
	assert.equal(ArrayType.of(NumberType).accepts([[1, 2], [3]]), false);
	assert.equal(ArrayType.of(NumberType).accepts([[1, '2']]), false);
	assert.deepEqual(ArrayType.present([[1, 2]]), { kind: 'table', value: [[1, 2]] });
	assert.deepEqual(ChartType.present({ kind: 'chart' }).kind, 'chart');
	for (const type of [StreamType, OptionalType, LambdaType]) assert.throws(() => type.present({}), /#VALUE!/);
	assert.throws(() => parameter('n', 'Number'), /descriptor/);
	assert.throws(() => defineFunction({ parameters: [], returns: 'Number', description: 'Invalid', run() {} }), /return type/);
});

test('generic result types bind descriptor identities and preserve nested structure', () => {
	const T = typeParameter('T'), differentT = typeParameter('T');
	const definition = defineFunction({ parameters: [parameter('value', T)], returns: OptionalType.of(ArrayType.of(T)), description: 'Generic example', run() {} });
	const result = resultType(definition, null, [NumberType]);
	assert.equal(result.base, OptionalType);
	assert.equal(result.arguments[0].base, ArrayType);
	assert.equal(result.arguments[0].arguments[0], NumberType);
	const unrelated = resultType({ ...definition, returns: differentT }, null, [TextType]);
	assert.equal(unrelated, AnyType);
	const first = resultType(StreamType.methods.findFirst, StreamType.of(BooleanType));
	assert.equal(first.base, OptionalType);
	assert.equal(first.arguments[0], BooleanType);
	const absent = evaluateFormula('rowstream(VSTACK("n",3)).limit(0).findFirst()', 0, 0, { streamExpression: true });
	assert.equal(OptionalType.of(NumberType).accepts(absent), true);
	const present = evaluateFormula('rowstream(VSTACK("n",3)).map(a->a.n).findFirst()', 0, 0, { streamExpression: true });
	assert.equal(OptionalType.of(NumberType).accepts(present), true);
	assert.equal(OptionalType.of(TextType).accepts(present), false);
	assert.ok(typeOf(present) instanceof FormulaType);
});
