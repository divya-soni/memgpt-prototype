const { elapsedMs, performance } = require("./timing");

function appendWorkingMemoryItem(workingMemory, content) {
    const startTime = performance.now();

    workingMemory.push(content);
    console.log(`[working-memory] append duration=${elapsedMs(startTime)}ms memory=${JSON.stringify(workingMemory)}`);
}

function replaceWorkingMemoryItem(workingMemory, oldContent, content) {
    const startTime = performance.now();
    const index = workingMemory.findIndex((item) => item === oldContent);

    if (index === -1) {
        console.log(`[working-memory] replace found=false duration=${elapsedMs(startTime)}ms memory=${JSON.stringify(workingMemory)}`);
        return false;
    }

    workingMemory[index] = content;
    console.log(`[working-memory] replace found=true duration=${elapsedMs(startTime)}ms memory=${JSON.stringify(workingMemory)}`);

    return true;
}

module.exports = {
    appendWorkingMemoryItem,
    replaceWorkingMemoryItem,
};
