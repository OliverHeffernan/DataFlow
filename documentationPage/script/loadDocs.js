// loading the documentation from the github readme, then rendering it into html.
async function getFileFromGitHub(fileURL) {
    try {
		// getting the raw text from README.md
        const response = await fetch(fileURL);

		// checking if it was successful
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

		// getting the raw text as a variable
        const fileContent = await response.text();
	
		// the url for the github markdown api
		const url = "https://api.github.com/markdown";

		// preparing the api request
		const payload = {
			text: fileContent,
			mode: "gfm",
		};

		// receiving the response from the api
		const apiResponse = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "applications/json"
			},
			body: JSON.stringify(payload),
		});

		// checking that it was successful
		if (!apiResponse.ok) {
			throw new Error(`Error: ${response.status} ${response.statusText}`);
		}

		// getting the html as a string
		const html = await apiResponse.text();

		// loading the html into the page
		document.getElementsByTagName("docs")[0].innerHTML = html;

		loadOutline(fileContent);

        return fileContent;
    } catch (error) {
        console.error('Error fetching file:', error);
        return null;
    }
}

async function loadOutline(md) {
	const lines = md.split("\n");

	let outline = "<ul class='sublist'>";
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].substring(0, 7) == "###### ") {
			outline += `<li class="list6">${lines[i].substring(7, lines[i].length)}</li>`;
		}
		else if (lines[i].substring(0, 6) == "##### ") {
			outline += `<li class="list5">${lines[i].substring(6, lines[i].length)}</li>`;
		}
		else if (lines[i].substring(0, 5) == "#### ") {
			outline += `<li class="list4">${lines[i].substring(5, lines[i].length)}</li>`;
		}
		else if (lines[i].substring(0, 4) == "### ") {
			outline += `<li class="list3">${lines[i].substring(4, lines[i].length)}</li>`;
		}
		else if (lines[i].substring(0, 3) == "## ") {
			outline += `<li class="list2">${lines[i].substring(3, lines[i].length)}</li>`;
		}
		else if (lines[i].substring(0, 2) == "# ") {
			outline += `<li class="list1">${lines[i].substring(2, lines[i].length)}</li>`;
		}
	}

	outline += "</ul>";

	/*
	const list2Items = outlineElement.querySelectorAll(".list2");
	list2Items.foreach((item, index) => {
		item.addEventListener("click", () {
			const target = getByTag("h2")[index];
		});
	});
	*/



	document.getElementsByTagName("docOutline")[0].innerHTML = outline;

	for (let i = 1; i < 7; i++) {
		addOnClicks(i);
	}
}

function addOnClicks(hn) {
	const items = [...document.querySelectorAll(`.list${hn}`)];
	items.forEach((item, index) => {
		item.addEventListener("click", () => {
			const target = getByTag(`h${hn}`)[index];
			if (target) scroll(target);
		});
	});
}

function scroll(element) {
	element.scrollIntoView({ behavior: "smooth" });
}

function getByTag(tag) {
	return document.getElementsByTagName(tag);
}

const fileURL = "https://raw.githubusercontent.com/OliverHeffernan/DataFlow/refs/heads/main/README.md";

getFileFromGitHub(fileURL);
