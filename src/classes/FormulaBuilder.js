// Read declarative builder calls and their source arguments, never executable JavaScript.
export function builderCalls(source, root) {
	let rest = source.replace(new RegExp(`^=\\s*${root}\\s*\\(\\s*\\)`), '');
	if (rest === source) throw new Error(`Start with ${root}()`);
	const result = [];
	while (rest.trim()) {
		const method = rest.match(/^\s*\.\s*([A-Za-z]+)\s*\(/);
		if (!method) throw new Error('Expected a builder method');
		rest = rest.slice(method[0].length);
		const args = [], stack = [];
		let quoted = null, start = 0, end = -1;
		for (let i = 0; i < rest.length; i++) {
			const char = rest[i];
			if (quoted) {
				if (char === '\\') i++;
				else if (char === "'" && quoted === "'" && rest[i + 1] === "'") i++;
				else if (char === quoted) quoted = null;
				continue;
			}
			if (char === '"' || char === "'") quoted = char;
			else if ('([{'.includes(char)) stack.push(char);
			else if (char === ')' && stack.length === 0) {
				const arg = rest.slice(start, i).trim();
				if (arg || args.length) args.push(arg);
				end = i; break;
			} else if (')]}'.includes(char)) {
				const expected = { ')': '(', ']': '[', '}': '{' }[char];
				if (stack.pop() !== expected) throw new Error('Mismatched brackets');
			} else if (char === ',' && stack.length === 0) {
				args.push(rest.slice(start, i).trim()); start = i + 1;
			}
		}
		if (end < 0) throw new Error('Unclosed method or quoted string');
		result.push({ method: method[1], args });
		rest = rest.slice(end + 1);
	}
	return result;
}
