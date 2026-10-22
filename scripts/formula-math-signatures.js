// Compile the installed mathjs public API declarations to real formula descriptors.
// This is generated input, not a second handwritten function/type reference.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parse } from '@babel/parser';

const root = new URL('../', import.meta.url);
const output = new URL('src/classes/FormulaMathSignatures.js', root);

export function generateMathSignatures() {
	const source = readFileSync(new URL('node_modules/mathjs/types/index.d.ts', root), 'utf8');
	const ast = parse(source, { sourceType: 'module', plugins: [['typescript', { dts: true }]] });
	const typeAliases = new Map(ast.program.body.map(item => item.declaration).filter(item => item?.type === 'TSTypeAliasDeclaration').map(item => [item.id.name, item]));
	const imports = new Set(['AnyType', 'NumberType', 'TextType', 'BooleanType', 'ComplexType', 'FractionType', 'BigIntType', 'UnitType', 'ArrayType', 'RowType', 'LambdaType', 'MathValueType', 'union', 'parameter', 'typeParameter', 'libraryType']);
	const aliases = {
		number: 'NumberType', BigNumber: 'NumberType', Decimal: 'NumberType', string: 'TextType', boolean: 'BooleanType', bigint: 'BigIntType', Complex: 'ComplexType', Fraction: 'FractionType', Unit: 'UnitType',
		MathNumericType: 'union(NumberType, BigIntType, FractionType, ComplexType)',
		MathScalarType: 'union(NumberType, BigIntType, FractionType, ComplexType, UnitType)',
		MathType: 'union(NumberType, BigIntType, FractionType, ComplexType, UnitType, ArrayType.of(AnyType))',
	};
	const unique = items => [...new Set(items)];
	function type(node, variables) {
		if (!node) return 'AnyType';
		const primitive = { TSNumberKeyword: 'NumberType', TSStringKeyword: 'TextType', TSBooleanKeyword: 'BooleanType', TSBigIntKeyword: 'BigIntType', TSAnyKeyword: 'AnyType', TSUnknownKeyword: 'AnyType', TSVoidKeyword: 'TextType', TSUndefinedKeyword: 'TextType', TSNullKeyword: 'TextType', TSTypePredicate: 'BooleanType', TSObjectKeyword: 'MathValueType' }[node.type];
		if (primitive) return primitive;
		if (node.type === 'TSTypeAnnotation' || node.type === 'TSParenthesizedType' || node.type === 'TSOptionalType' || node.type === 'TSRestType') return type(node.typeAnnotation, variables);
		if (node.type === 'TSUnionType' || node.type === 'TSIntersectionType') {
			const options = unique(node.types.map(node => type(node, variables)));
			return options.length === 1 ? options[0] : `union(${options.join(', ')})`;
		}
		if (node.type === 'TSArrayType') return `ArrayType.of(${type(node.elementType, variables)})`;
		if (node.type === 'TSTupleType') return `RowType.of(${node.elementTypes.map(node => type(node, variables)).join(', ')})`;
		if (node.type === 'TSFunctionType') return 'libraryType("LibraryCallback")';
		if (node.type === 'TSTypeLiteral') return 'MathValueType';
		if (node.type === 'TSLiteralType') return ({ StringLiteral: 'TextType', NumericLiteral: 'NumberType', BooleanLiteral: 'BooleanType' })[node.literal.type] ?? 'AnyType';
		if (node.type === 'TSTypeReference') {
			const name = node.typeName.name;
			const args = node.typeParameters?.params ?? [];
			if (variables.has(name)) return `variables.${name}`;
			if (aliases[name]) return aliases[name];
			if (['MathArray', 'MathCollection', 'Matrix', 'Array'].includes(name)) return `ArrayType.of(${args.length ? type(args[0], variables) : 'AnyType'})`;
			if (['NoLiteralType', 'MathGeneric'].includes(name)) return args.length ? type(args[0], variables) : aliases.MathNumericType;
			if (name === 'MathExpression') return 'union(TextType, ArrayType.of(TextType))';
			if (name === 'Function') return 'libraryType("LibraryCallback")';
			const alias = typeAliases.get(name);
			if (alias && !alias.typeParameters && ['TSUnionType', 'TSLiteralType'].includes(alias.typeAnnotation.type)) {
				return `libraryType(${JSON.stringify(name)}, ${type(alias.typeAnnotation, variables)}, ${JSON.stringify(source.slice(alias.start, alias.end).replace(/\s+/g, ' '))})`;
			}
			return `libraryType(${JSON.stringify(name)})`;
		}
		return 'AnyType'; // The upstream declaration is preserved alongside unresolved types.
	}
	const definitions = new Map();
	for (const statement of ast.program.body) {
		const declaration = statement.declaration;
		if (declaration?.type !== 'TSInterfaceDeclaration' || declaration.id.name !== 'MathJsInstance') continue;
		let comment = '';
		for (const member of declaration.body.body) {
			const signature = member.type === 'TSMethodSignature' ? member : member.typeAnnotation?.typeAnnotation?.type === 'TSFunctionType' ? member.typeAnnotation.typeAnnotation : null;
			if (!signature || !member.key?.name) continue;
			const jsdoc = member.leadingComments?.filter(item => item.type === 'CommentBlock').at(-1)?.value;
			if (jsdoc) comment = jsdoc.replace(/^\s*\* ?/gm, '').trim();
			const variables = new Set(signature.typeParameters?.params.map(param => param.name) ?? []);
			const params = signature.parameters.map(param => {
				const rest = param.type === 'RestElement';
				const name = rest ? param.argument.name : param.name;
				let annotation = param.typeAnnotation?.typeAnnotation;
				if (rest && annotation?.type === 'TSArrayType') annotation = annotation.elementType;
				const options = { ...(param.optional ? { optional: true } : {}), ...(rest ? { rest: true } : {}) };
				const description = comment.match(new RegExp(`@param ${name}\\s+([\\s\\S]*?)(?=\\n@|$)`))?.[1]?.trim().replace(/\s+/g, ' ');
				if (description) options.description = description;
				return `parameter(${JSON.stringify(name)}, ${type(annotation, variables)}, ${JSON.stringify(options)})`;
			});
			const result = `(() => { const variables = {${[...variables].map(name => `${name}: typeParameter(${JSON.stringify(name)})`).join(', ')}}; return { parameters: [${params.join(', ')}], returns: ${type(signature.typeAnnotation, variables)}, declaration: ${JSON.stringify(source.slice(member.start, member.end).replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' '))} }; })()`;
			if (!definitions.has(member.key.name)) definitions.set(member.key.name, []);
			definitions.get(member.key.name).push(result);
		}
	}
	return `// Generated by npm run docs:generate from mathjs public declarations. Do not edit.\nimport { ${[...imports].join(', ')} } from './FormulaTypes.js';\n\nexport const mathSignatures = {\n${[...definitions].map(([name, signatures]) => `\t${JSON.stringify(name)}: [${signatures.join(',\n\t\t')}],`).join('\n')}\n};\n`;
}

export function writeMathSignatures(check = false) {
	const generated = generateMathSignatures();
	if (check) {
		if (readFileSync(output, 'utf8') !== generated) throw new Error('Math signatures are stale; run npm run docs:generate');
	} else writeFileSync(output, generated);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) writeMathSignatures(process.argv.includes('--check'));
