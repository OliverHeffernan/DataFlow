// Formula types are descriptors, not JavaScript constructors or executable user properties.
// Presentation describes a result; the sheet still owns rendering and spill placement.
export class FormulaError extends Error {
	constructor(message, explanation = message) { super(message); this.explanation = explanation; }
}

const brands = new WeakMap();
export const formulaTypes = [];

export class FormulaType {
	constructor(name, description, accepts, present = value => ({ kind: 'scalar', value }), { register = true } = {}) {
		Object.assign(this, { name, description, accepts, present, methods: Object.create(null), arguments: [] });
		if (register) formulaTypes.push(this);
	}
	brand(value) { brands.set(value, this); return value; }
	toString() { return this.name; }
	resolve(bindings) { return this.parameter ? bindings.get(this) ?? AnyType : this; }
	method(name) { return Object.hasOwn(this.methods, name) ? this.methods[name] : null; }
}

export const AnyType = new FormulaType('Any', 'An unconstrained formula value. A concrete runtime value still has a type; this is not permission to access JavaScript properties.', () => true);
export const NumberType = new FormulaType('Number', 'A real number. Decimal arithmetic retains 64 significant digits internally. Display, charts and native-number-only library functions use native-number precision. Infinity and NaN are numeric values where the operation permits them.', value => typeof value === 'number' || (!brands.has(value) && Boolean(value?.isBigNumber)));
export const TextType = new FormulaType('Text', 'Case-sensitive text. Blank cells and empty text both evaluate to ""; neither is Optional.empty.', value => typeof value === 'string');
export const BooleanType = new FormulaType('Boolean', 'TRUE or FALSE. Spreadsheet conditions additionally accept numeric and boolean-like text through explicit condition conversion.', value => typeof value === 'boolean');
export const ComplexType = new FormulaType('Complex', 'A mathjs complex number. Supported by compatible mathematical functions, not by exact lookup keys or chart series.', value => !brands.has(value) && Boolean(value?.isComplex));
export const UnitType = new FormulaType('Unit', 'A mathjs quantity with units. Use compatible math functions and unit conversion; not an exact lookup key or chart value.', value => !brands.has(value) && Boolean(value?.isUnit));
export const FractionType = new FormulaType('Fraction', 'A mathjs exact fraction. Available to compatible mathematical functions; spreadsheet numeric conversion and key rules are documented per function.', value => !brands.has(value) && Boolean(value?.isFraction));
export const BigIntType = new FormulaType('BigInt', 'A mathjs/native arbitrary-precision integer, distinct from the default decimal Number. Only compatible mathematical functions accept it.', value => typeof value === 'bigint');

export function union(...types) {
	types = [...new Set(types.flatMap(type => type.members && !type.alias ? type.members : [type]))];
	const type = new FormulaType(types.map(type => type.name).join(' | '), 'One of the listed types.', value => types.some(type => type.accepts(value)), undefined, { register: false });
	type.members = types;
	type.resolve = bindings => {
		const resolved = types.map(type => type.resolve(bindings));
		return resolved.every((item, i) => item === types[i]) ? type : union(...resolved);
	};
	return type;
}
export const ScalarType = union(NumberType, TextType, BooleanType, ComplexType, UnitType, FractionType, BigIntType);
ScalarType.name = 'Scalar';
ScalarType.alias = true;
formulaTypes.push(ScalarType);
ScalarType.description = 'A single Number, Text, Boolean, Complex, Unit, Fraction or BigInt value. Arrays and expression-only values are not scalars.';
export const NumericInputType = new FormulaType('NumericInput', 'A Number, Boolean, or numeric/blank Text accepted by spreadsheet numeric conversion. TRUE/FALSE become 1/0; blank becomes 0. Other text errors. Conversion is explicit in the operation, not implicit Optional unwrapping.', value => NumberType.accepts(value) || BooleanType.accepts(value) || (TextType.accepts(value) && (!value.trim() || /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$|^[+-]?Infinity$/i.test(value.trim()))));
export const ConditionType = new FormulaType('Condition', 'A scalar condition: Boolean, Number, blank, TRUE/FALSE text or numeric text. Blank/zero/FALSE are false; other nonnumeric text errors.', value => NumericInputType.accepts(value) || (TextType.accepts(value) && /^(true|false)$/i.test(value.trim())));

export function typeParameter(name) {
	const type = new FormulaType(name, 'A type parameter bound by the receiver or arguments; no formula annotations are required.', () => true, undefined, { register: false });
	type.parameter = true;
	return type;
}

function generic(name, description, accepts, present) {
	const base = new FormulaType(name, description, accepts, present);
	base.of = (...args) => {
		if (!args.every(arg => arg instanceof FormulaType)) throw new TypeError('Generic arguments must be formula type descriptors');
		const type = Object.create(base);
		Object.assign(type, { name: `${name}<${args.map(arg => arg.name).join(', ')}>`, base, arguments: args });
		if (base === OptionalType) type.accepts = value => base.accepts(value) && (!value.present || args[0].accepts(value.value));
		if (base === ArrayType) type.accepts = value => base.accepts(value) && value.every(row => Array.isArray(row) && row.length === value[0].length && row.every(item => args[0].accepts(item)));
		if (base === RowType) type.accepts = value => base.accepts(value) && Array.isArray(value[0]) && (args.length === 1 ? value[0].every(item => args[0].accepts(item)) : value[0].length === args.length && value[0].every((item, i) => args[i].accepts(item)));
		if (base === LambdaType) type.accepts = value => base.accepts(value) && value.params.length === args.length - 1;
		type.resolve = bindings => base.of(...args.map(arg => arg.resolve(bindings)));
		return type;
	};
	return base;
}

const expressionOnly = name => () => { throw new FormulaError('#VALUE!', `${name} must be resolved before displaying a cell`); };
export const ArrayType = generic('Array', 'A rectangular two-dimensional array. Scalars can be promoted to 1×1 arrays by array functions. Array results spill; 1×1 results display as a scalar. Shapes must match unless scalar broadcasting is documented.', Array.isArray, value => ({ kind: 'table', value }));
export const RowType = generic('Row', 'A positional single-row array, used as one stream item. A row projection receives column1, column2, … headings unless overridden.', value => Array.isArray(value) && value.length === 1, ArrayType.present);
export const TableType = generic('Table', 'A headed rectangular array. The first row contains headings, including when there are no data rows. Object keys supply headings; table fields must be scalar. Normal spill collision and boundary checks apply.', Array.isArray, ArrayType.present);
export const RecordType = generic('Record', 'An immutable record with named fields. Stream headings and object projections define its schema. Field names are case-sensitive; access uses a.name or a["Last Name"]. At the cell boundary a record becomes a headed one-row table.', value => brands.get(value)?.base === RecordType || brands.get(value) === RecordType, value => ({ kind: 'record', value }));
RecordType.of = fields => {
	if (!fields || Object.values(fields).some(type => !(type instanceof FormulaType))) throw new TypeError('Record fields must be formula type descriptors');
	const type = Object.create(RecordType);
	Object.assign(type, { name: `Record<{${Object.entries(fields).map(([key, type]) => `${key}: ${type.name}`).join(', ')}}>`, base: RecordType, fields: Object.freeze({ ...fields }) });
	type.accepts = value => RecordType.accepts(value) && Object.keys(value).length === Object.keys(fields).length && Object.entries(fields).every(([key, type]) => Object.hasOwn(value, key) && type.accepts(value[key]));
	type.resolve = bindings => RecordType.of(Object.fromEntries(Object.entries(fields).map(([key, type]) => [key, type.resolve(bindings)])));
	return type;
};
export const StreamType = generic('Stream', 'A lazy sequence of items, created from headed ranges. A terminal operation is mandatory. Filter/map/limit/skip use generators; sorting buffers; distinct stores seen keys. Source errors propagate when read.', value => brands.get(value)?.base === StreamType || brands.get(value) === StreamType, () => { throw new FormulaError('#VALUE!', 'A stream requires a terminal operation such as reduce() or toTable()'); });
export const OptionalType = generic('Optional', 'Either one present value or empty. Zero, FALSE and empty text are present. Missing stream results are empty; invalid input and calculation errors still propagate. Explicitly unwrap before display, arithmetic, table fields or ordinary function arguments. map/filter do not invoke callbacks when empty. Unlike Java, orElse evaluates its fallback only when empty, like spreadsheet IF.', value => brands.get(value)?.base === OptionalType || brands.get(value) === OptionalType, () => { throw new FormulaError('#VALUE!', 'An Optional requires orElse(...) or orElseThrow() before displaying a cell'); });
export const LambdaType = generic('Lambda', 'An interpreted expression callback, written a->expression or (a,b)->expression. Parameters are lexically scoped. No statements, mutation, JavaScript execution, arbitrary methods or prototype access. Callback arity is validated by its consumer.', value => brands.get(value)?.base === LambdaType || brands.get(value) === LambdaType, expressionOnly('A lambda'));
export const ChartType = new FormulaType('Chart', 'A declarative CHART() builder rendered over the grid. It occupies one formula cell, not spill cells. A builder without a chart type displays blank; a typed builder needs a series. Chart arguments are restricted literals/references, not general expressions. Charts cannot be numeric formula inputs.', value => value?.kind === 'chart', value => ({ kind: 'chart', value }));
export const ConditionalRuleType = new FormulaType('ConditionalRule', 'A declarative CF() builder applied through the conditional-format pane. It requires a local absolute range and foreground/background/alignment. A predicate is evaluated per target cell; rules are not scalar cell data.', value => Boolean(value?.colors && value?.range && typeof value?.predicate === 'string'), expressionOnly('A conditional rule'));
export const ReferenceType = new FormulaType('Reference', 'A cell, range or named/dataset reference. This describes argument syntax, not a separately stored cell value. Resolution reads values in the current workbook context. Builder methods document which reference forms they accept.', () => true, expressionOnly('A reference'));
export const MathValueType = new FormulaType('MathValue', 'An additional mathjs value (for example ResultSet). Only compatible library overloads accept it. No arbitrary property/method access is permitted. Library-specific values display using their existing string representation.', value => value !== null && typeof value === 'object', value => ({ kind: 'scalar', value }));

const libraryTypes = new Map();
export function libraryType(name, underlying = MathValueType, declaration = '') {
	if (!libraryTypes.has(name)) libraryTypes.set(name, new FormulaType(`Math.${name}`,
		name === 'LibraryCallback' ? 'A JavaScript callback required by a mathjs overload. Not available in formulas: formula lambdas are safe interpreted objects, not JavaScript functions. Use Stream/Optional callback methods instead.'
			: `An upstream mathjs type. ${declaration || 'Produced and consumed by compatible library functions; general JavaScript object construction and property access are unavailable.'}`,
		name === 'LibraryCallback' ? value => typeof value === 'function' : underlying.accepts, underlying.present));
	return libraryTypes.get(name);
}

export function typeOf(value) {
	if (value && typeof value === 'object' && brands.has(value)) return brands.get(value);
	if (Array.isArray(value)) return ArrayType.of(AnyType);
	return [NumberType, TextType, BooleanType, ComplexType, UnitType, FractionType, BigIntType, ChartType].find(type => type.accepts(value)) ?? MathValueType;
}

export function parameter(name, type, options = {}) {
	if (!(type instanceof FormulaType)) throw new TypeError('Parameter types must be formula type descriptors');
	return { name, type, ...options };
}

// One definition owns runtime code, structured signatures and reference documentation.
export function defineFunction(definition) {
	const { parameters, returns, description, run } = definition;
	if (!Array.isArray(parameters) || !(returns instanceof FormulaType) || !description || typeof run !== 'function') throw new TypeError('A formula definition needs typed parameters, return type, description and implementation');
	const rest = parameters.find(param => param.rest);
	return { min: parameters.filter(param => !param.optional && !param.rest).length + (rest?.required ? 1 : 0), max: rest ? Infinity : parameters.length, errors: [], examples: [], ...definition };
}

export function argumentHelp(definition) {
	return definition.parameters.flatMap(param => param.help ? [param.help] : param.rest ? [param.name, '…'] : [param.optional ? `[${param.name}${param.default === undefined ? '' : ` = ${JSON.stringify(param.default)}`}]` : param.name]);
}

export function validateArguments(definition, values) {
	for (let i = 0; i < values.length; i++) {
		const param = definition.parameters[i] ?? definition.parameters.find(param => param.rest);
		if (param && !param.lazy && !param.type.accepts(values[i])) throw new FormulaError('#VALUE!', `${param.name} must be ${param.type.name}; got ${typeOf(values[i]).name}`);
	}
}

export function validateResult(definition, value) {
	const type = definition.returns;
	if (!type.accepts(value)) throw new FormulaError('#VALUE!', `Expected result ${type.name}; got ${typeOf(value).name}`);
	if (type.base === OptionalType && value.present && !type.arguments[0].accepts(value.value)) throw new FormulaError('#VALUE!', `Expected Optional<${type.arguments[0].name}>`);
	return value;
}

// Bind object-valued type parameters from known receiver/argument types. Unread stream
// items and unevaluated callbacks remain Any; inference never consumes a source or calls a lambda.
export function resolveSignature(definition, receiverType, argumentTypes = []) {
	const bindings = new Map();
	function bind(pattern, actual) {
		if (!actual || actual === AnyType) return;
		if (pattern.parameter) { if (!bindings.has(pattern)) bindings.set(pattern, actual); return; }
		if (pattern.base && pattern.base === actual.base) pattern.arguments.forEach((arg, i) => bind(arg, actual.arguments[i]));
	}
	if (receiverType?.itemParameter) bind(receiverType.itemParameter, receiverType.arguments[0]);
	definition.parameters.forEach((param, i) => { if (!param.lazy) bind(param.type, argumentTypes[i]); });
	return {
		parameters: definition.parameters.map(param => ({ ...param, type: param.type.resolve(bindings) })),
		returns: definition.returns.resolve(bindings),
	};
}

export function resultType(definition, receiverType, argumentTypes = []) {
	return resolveSignature(definition, receiverType, argumentTypes).returns;
}
