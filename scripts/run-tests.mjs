import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const files = readdirSync(__dirname).filter(file => file.endsWith("-test.mjs"));

console.log("🚀 Starting Test Suite...");

for (const file of files) {
    console.log(`\n▶ Running ${file}...`);
    try {
        await import(pathToFileURL(join(__dirname, file)).href);
        console.log(`✅ ${file} passed!`);
    } catch (e) {
        console.error(`❌ ${file} failed!`);
        console.error(e);
        process.exit(1);
    }
}

console.log("\n🎉 All tests passed successfully!");
