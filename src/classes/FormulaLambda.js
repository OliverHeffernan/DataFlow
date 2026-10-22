// Lower only lambda syntax; mathjs still parses expressions, records, accessors and method chains.
// Bodies remain source until interpreted in a lexical scope. No JavaScript is compiled or executed.
export function extractLambdas(source, quotedEnd, matching) {
	const lambdas = [];
	let text = '';
	for (let at = 0; at < source.length;) {
		if (source[at] === '"' || source[at] === "'") {
			const end = quotedEnd(source, at);
			text += source.slice(at, end); at = end; continue;
		}
		const match = !/[\w.]/.test(source[at - 1] ?? '') && source.slice(at).match(/^(?:([A-Za-z_]\w*)|\(\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*\))\s*->/);
		if (!match) { text += source[at++]; continue; }
		const params = (match[1] ?? match[2]).split(',').map(name => name.trim());
		const start = at + match[0].length;
		let end = start;
		for (; end < source.length; end++) {
			const char = source[end];
			if (char === '"' || char === "'") end = quotedEnd(source, end) - 1;
			else if ('([{'.includes(char)) {
				const close = matching(source, end);
				if (close < 0) break; // The expression parser reports malformed delimiters.
				end = close;
			} else if (',;)]}'.includes(char)) break;
		}
		const body = source.slice(start, end).trim();
		const name = `DFLAMBDA__${lambdas.length}`;
		lambdas.push({ name, params, body });
		text += name; at = end;
	}
	return { text, lambdas };
}
