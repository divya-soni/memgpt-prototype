function extractJsonObject(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
        return text;
    }

    return text.slice(start, end + 1);
}

function parseJsonResponse(text) {
    try {
        return JSON.parse(text);
    } catch {
        return JSON.parse(extractJsonObject(text));
    }
}

module.exports = {
    parseJsonResponse,
};
