// Consumers share definitions; implementations and prose stay with their owning operations.
import { formulaFunctions, mathFunctions } from './FormulaFunctions.js';
import { chartFunction } from './ChartFormula.js';
import { conditionalFunction } from './ConditionalFormatting.js';
import { ChartType, ConditionalRuleType, StreamType, OptionalType, argumentHelp } from './FormulaTypes.js';

export const formulaCatalog = { ...formulaFunctions, CHART: chartFunction, CF: conditionalFunction, ...mathFunctions };
export const methodTypes = [StreamType, OptionalType, ChartType, ConditionalRuleType];
export const functionHelp = Object.fromEntries([
	...Object.entries(formulaCatalog),
	...methodTypes.flatMap(type => Object.entries(type.methods).map(([name, definition]) => [`.${name}`, definition])),
].map(([name, definition]) => [name, argumentHelp(definition)]));
