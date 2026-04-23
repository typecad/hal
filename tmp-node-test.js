const funcName='Button.start';
const escapedFuncName = funcName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
const re = new RegExp(`\\b${escapedFuncName}\\s*\\(([^)]*)\\)\\.`, 'g');
const code='Button.start(2, 50).onPress(sketch_isr_0)';
console.log('pattern:', re);
console.log('result:', code.replace(re, `${funcName}($1)->`));
