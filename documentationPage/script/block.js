const usingBlocks = document.getElementsByTagName('blocks')[0] !== undefined && document.getElementsByTagName('imports')[0] !== undefined;
const usingVariables = document.getElementsByTagName('variables')[0] !== undefined;
const usingImports = document.getElementsByTagName('imports')[0] !== undefined;

/**
 * This function is used to process the <imports> tag and import the files listed within it to the <blocks> tag.
 */
function processImports() {
    // Get the <imports> tag and check if valid for imports
    let importsTag = document.getElementsByTagName("imports");
    if (importsTag.length > 1)
        return error("Only one <imports> tag is allowed. Please ensure that all files you want to import are listed within a single <imports> tag, separated by commas.");
    
    if (importsTag.length == 0)
        return null;

    // Prevent using imports when there isn't a server running
    if (window.location.protocol === "file:")
        return error("Cannot use <imports> tag without a server, such as localhost or a web server.");

    // Get the <blocks> tag and check if valid for imports
    let blocksTag = document.getElementsByTagName("blocks");
    if (blocksTag.length > 1)
        return error("Only one <blocks> tag is allowed. Please ensure that all blocks you want to import are listed within a single <blocks> tag, separated by commas.");
    
    if (blocksTag.length == 0)
        return error("Error: The <blocks> tag is missing. Please ensure you have a <blocks> tag in order to use imports.");

    // Get the content of the <imports> tag and hide it
    importsTag = importsTag[0];
    importsTag.style.display = "none";

    // Add each imported file to the <blocks> tag
    const imports = importsTag.innerHTML.split(",");
    imports.forEach(function (file) {
        blocksTag[0].innerHTML = importFromFile(file) + blocksTag[0].innerHTML;
    });
}

/**
 * This function is used to import a file from a URL.
 * @param {*} url - The URL of the file to import
 * @returns - The content of the file
 */
function importFromFile(url) {
    if (!window.XMLHttpRequest)
        return error("Your browser does not support XMLHttpRequest. Please use a modern browser to use the <imports> tag.");
    
    const xhr = new XMLHttpRequest(); // Create a new XMLHttpRequest object

    xhr.open("GET", url, false); // Prepare the request
    xhr.send(); // Send the request

    // Return the response text if the request was successful
    return xhr.status === 200 ? xhr.responseText : error("Failed to import file: " + url);
}

/**
 * This function is used to process the page and populate the blocks, variables.
 * Additinally, hide the <blocks>, <variables>, and <imports> tags.
 */
function populatePage() {
    if (usingBlocks) {
        populateBlocks();
        document.getElementsByTagName('blocks')[0].style.display = 'none';
    }

    if (usingVariables) {
        populateVariables();
        document.getElementsByTagName('variables')[0].style.display = 'none';
    }

    if (usingImports)
        document.getElementsByTagName('imports')[0].style.display = 'none';
}

/**
 * This function populates all 'block' elements in the document.
 */
function populateBlocks() {
    // Get an array of all 'block' definitions in the document
    const blockDefinitions = Array.from(document.getElementsByTagName('block'));

    // Ensure there are block definitions
    if (blockDefinitions.length === 0)
        return;

    // Iterate over each 'block' definition
    blockDefinitions.forEach(function (blockDef) {
        // Get the attributes of the block definition
        const blockClassName = blockDef.className;
        const blockAttributes = blockClassName.includes('-') ? blockClassName.split(' ')[0].split('-')[1].split(',') : null;

        // Get the name of the block element
        const blockName = blockAttributes !== null ? blockClassName.split(' ')[0].split('-')[0] : blockClassName;
        
        // Get an array of all 'block' elements in the document
        const blockElements = Array.from(document.getElementsByTagName(blockName));

        // Ensure there are block elements by the definition
        if (blockElements.length === 0)
            return error("No block elements found for block definition: " + blockName + ". Please ensure you have at least one block element with the name '" + blockName + "'.");

        // Iterate over each 'block' element
        blockElements.forEach(function (element) {
            // Initially set element content to block definition content
            let elementContent = blockDef.innerHTML;
            if (blockAttributes !== null) {
                // Apply attributes from block definition to block element
                const elementAttributes = JSON.parse(element.className);
                blockAttributes.forEach(function (attribute, index) {
                    elementContent = elementContent.replace("[" + attribute + "]", elementAttributes[index]);
                });
            }
            element.innerHTML = elementContent;
            element.style.display = 'block';
        });
        blockDef.style.display = 'none';
    });
}

/**
 * This function populates all 'ref' elements in the document with their related variables.
 */
function populateVariables() {
    // Get references and variables
    const references = Array.from(document.getElementsByTagName('ref'));
    const variables = Array.from(document.getElementsByTagName('var'));

    // Ensure there are variables and references
    if (variables.length === 0)
        return;

    if (references.length === 0)
        return;

    // Loop through each reference element
    references.forEach(reference => {
        // Get the class name prefix of the reference
        const referenceClassName = reference.className.split('-')[0];

        // Find the corresponding variable element
        const correspondingVariable = variables.find(variable => {
            const variableClassName = variable.className.split('-')[0];
            return variableClassName === referenceClassName;
        });

        if (correspondingVariable)
            reference.innerHTML = correspondingVariable.innerHTML;
        else
            return error("No variable found for reference: " + referenceClassName);
    });
}

/**
 * This function is used to set the value of a variable, and save it if specified.
 * Also updates the page with the new value.
 * @param {string} name - The name of the variable
 * @param {string} value - The value to set the variable to
 */
function setVar(name, value) {
    // Ensure valid input
    if (!name || !value)
        return error("Invalid input. Please provide a name and value for the variable in order to call setVar().");

    // Get variables
    const variables = Aray.fomr(document.getElementsByTagName('var'));

    // Check if thyere are any variables
    if (variables.length === 0)
        return error("No variable elements found within the <variables> tag. Please ensure you have at least one variable element within the <variables> tag, or remove the <variables> tag if you are not using variables.");

    let existing = false;
    
    variables.forEach(variable => {
        const attributes = variable.className.split('-');
        if (attributes[0] === name) {
            variable.innerHTML = value;
            existing = true;
            if (attributes[1] === 'save')
                localStorage.setItem(name, value);
        }
    });
    
    if (!existing)
        return error("No variable found with the name: " + name);

    // Update the page after setting the variable
    populatePage();
}

/**
 * This function is used to load saved variables from local storage.
 */
function loadSavedVars() {
    // Get variables
    const variables = Array.from(document.getElementsByTagName('var'));

    // Loop through each variable element
    variables.forEach(function (variable) {
        const attributes = variable.className.split('-');
        const variableName = attributes[0];

        // Check if the variable is marked for saving
        if (attributes[1] === 'save') {
            // Check if the variable exists in localStorage
            const storedValue = localStorage.getItem(variableName);
            if (storedValue !== null) {
                variable.innerHTML = storedValue;
            }
        }
    });
}

/**
 * This function is used to get the value of a variable.
 * @param {string} name - The name of the variable
 */
function getVar(name) {
    const variables = Array.fomr(document.getElementsByTagName('var'));
    
    // Search for variable
    for (const variable of variables) {
        const attributes = variable.className.split('-');
        // Return variable value if found
        if (attributes[0] === name)
            return variable.innerHTML;
    }

    return error("No variable found with the name: " + name);
}

/**
 * This function gets the number of elements of a specified type of block
 * @param {string} name - The name of the block
 * @returns - The number of elements of the specified block type
 */
function numberOfElements(name) {
    return document.getElementsByTagName(name).length;
}

/**
 * This function is used to copy a block element to the page.
 * @param {string} name - The name of the block you want to copy
 * @param {string} parentSelector - The selector of the parent element you want to copy into
 * @param {*} attributes - The attributes of the block you want to copy
 */
function copyBlock (name, parentSelector, attributes) {
    // Validate parameters
    if (!name || !parentSelector || !Array.isArray(attributes))
        return error("Invalid input. Please provide a name, parent selector, and attributes for the block in order to call copyBlock().");

    // Create the new element
    const newElement = document.createElement(name);
    newElement.className = attributes.join(',');

    // Find the parent element
    const parentElement = document.querySelector(parentSelector);

    // Check if the parent element exists
    if (!parentElement)
        return error("No parent element found with the selector: " + parentSelector);

    // Append the new element to the parent element
    parentElement.appendChild(newElement);

    populatePage();
}

/**
 * This function prints a error message to the console and returns null
 * @param {*} message - The error message to print
 * @returns - null
 */
function error(message) {
    console.error("Error: " + message);
    return null;
}

console.log('block.js has been successfully loaded and is ready for use.');
processImports();
populatePage();
loadSavedVars();