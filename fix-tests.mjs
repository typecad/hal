import fs from 'fs';
import path from 'path';

function walkDir(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walkDir(file));
        } else {
            if (file.endsWith('.test.ts')) {
                results.push(file);
            }
        }
    });
    return results;
}

const testFiles = walkDir('./tests');

for (const file of testFiles) {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;

    // We want to add target and mcu if they are missing in test configurations that look like:
    // "  board: '@typehal/board-arduino-uno',"
    // "  target: 'generic',"

    // Pattern 1: Target generic without mcu
    if (content.includes('"  target: \'generic\',"') && !content.includes('"  mcu: \'@typehal/mcu-generic\',"')) {
        content = content.replace(/"  target: 'generic',"/g, "\"  target: 'generic',\"\n        \"  mcu: '@typehal/mcu-generic',\"");
        changed = true;
    }
    
    if (content.includes('"  target: \'arduino\',"') && !content.includes('"  mcu: \'@typehal/mcu-atmega328p\',"')) {
        content = content.replace(/"  target: 'arduino',"/g, "\"  target: 'arduino',\"\n        \"  mcu: '@typehal/mcu-atmega328p',\"");
        changed = true;
    }

    if (content.includes('target: "arduino",') && !content.includes('mcu:')) {
        content = content.replace(/target: "arduino",/g, "target: \"arduino\",\n      mcu: \"@typehal/mcu-atmega328p\",");
        changed = true;
    }
    
    if (content.includes('target: "generic",') && !content.includes('mcu:')) {
        content = content.replace(/target: "generic",/g, "target: \"generic\",\n      mcu: \"@typehal/mcu-generic\",");
        changed = true;
    }

    // Transpile config objects
    if (changed) {
        fs.writeFileSync(file, content, 'utf8');
        console.log("Updated", file);
    }
}
