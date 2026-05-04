const { startCli } = require("./src/cli");

startCli().catch((error) => {
    console.error(error);
    process.exit(1);
});
