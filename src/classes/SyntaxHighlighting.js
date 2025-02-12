const operators = ["&#47", "+", "-", "*", "&lt;", "&gt;", "&#61;"];
const functions = ["SUM", "SUMIF", "AVG", "AVGIF", "COUNT", "COUNTIF"].sort((a, b) => b.length - a.length);
export default class SyntaxHighlighting {
	highlight(form) {
		// need to do the equals first, as it can be interfered with when there is an equal sign in the span tags.
		// this is the same reasons that we do the / first.
		// there should only be one highlighted equal sign in a formula
		if (form[0] !== "=") {
			return form;
		}/* else {
			form = form.substring(1);
		}*/

		form = this.preventHtmlInjection(form);


		for (let i = 0; i < operators.length; i++) {
			form = form.replaceAll(operators[i], "<span class='operator'>" + operators[i] + "</span>");
		}

		for (let i = 0; i < functions.length; i++) {
			form = form.replaceAll(functions[i], "<span class='function'>" + functions[i] + "</span>");
		}
		//return "<span class='operator'>=</span>" + form;
		//
		form = this.rainbowBraces(form, "(", ")");
		form = this.rainbowBraces(form, "{", "}");
		form = this.rainbowBraces(form, "[", "]");
		return form;
	}

	preventHtmlInjection(form) {
		form = form.replaceAll("<", "&lt;");
		form = form.replaceAll(">", "&gt;");
		form = form.replaceAll("=", "&#61;");
		form = form.replaceAll("/", "&#47");
		return form;
	}

	rainbowBraces(form, open, close) {
		let depth = 0;
		let returning = "";
		for (let i = 0; i < form.length; i++) {
			if (form[i] === open) {
				depth++;
				returning += `<span class="depth${this.cycleDepth(depth)}">${form[i]}</span>`;
			} else if (form[i] === close) {
				returning += `<span class="depth${this.cycleDepth(depth)}">${form[i]}</span>`;
				depth--;
			} else {
				returning += form[i];
			}
		}
		return returning;
	}

	cycleDepth(depth) {
		while (depth > 6) {
			depth -= 6;
		}

		depth = Math.max(0, depth);
		return depth;
	}
}
