import fs from 'fs';
import path from 'path';

const requiredPaths = [
    'module.json',
    'dist/main.js',
    'public/style.css',
    'public/templates/sustain-reminder.hbs'
];

console.log("Starting Smoke Test...");

let failed = false;

requiredPaths.forEach(p => {
    if (fs.existsSync(path.resolve(p))) {
        console.log(`Found: ${p}`);
    } else {
        console.error(`MISSING: ${p}`);
        failed = true;
    }
});

// Extra check: Is the JS file actually populated?
if (!failed) {
    const stats = fs.statSync('dist/main.js');
    if (stats.size < 100) {
        console.error("dist/main.js is suspiciously small. Did the build fail?");
        failed = true;
    }
}

if (failed) {
    console.error("Smoke test failed!");
    process.exit(1);
} else {
    console.log("All structures verified. Proceeding to release.");
    process.exit(0);
}