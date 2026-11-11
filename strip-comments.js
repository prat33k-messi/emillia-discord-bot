const fs = require('fs');
const path = require('path');
const vm = require('vm');

const filePath = path.join(__dirname, 'index.js');
const backupPath = path.join(__dirname, 'index.js.bak');

const originalCode = fs.readFileSync(filePath, 'utf8');

// 1. Create a safe backup first
fs.writeFileSync(backupPath, originalCode, 'utf8');
console.log(`[1/4] Safe backup saved to ${backupPath}`);

// 2. Safe AST-free JavaScript comment stripper state machine
function stripComments(code) {
  let out = '';
  let i = 0;
  const len = code.length;
  let state = 'CODE';
  const templateDepth = [];

  while (i < len) {
    const ch = code[i];
    const next = code[i + 1];

    if (state === 'CODE') {
      if (ch === '/' && next === '/') {
        state = 'LINE_COMMENT';
        i += 2;
      } else if (ch === '/' && next === '*') {
        state = 'BLOCK_COMMENT';
        i += 2;
      } else if (ch === "'") {
        state = 'SINGLE_QUOTE';
        out += ch;
        i++;
      } else if (ch === '"') {
        state = 'DOUBLE_QUOTE';
        out += ch;
        i++;
      } else if (ch === '`') {
        state = 'TEMPLATE';
        out += ch;
        i++;
      } else if (ch === '/') {
        let k = out.length - 1;
        while (k >= 0 && /\s/.test(out[k])) k--;
        const prev = k >= 0 ? out[k] : '';
        const prevWord = out.slice(Math.max(0, k - 10), k + 1).match(/[a-zA-Z0-9_$]+$/)?.[0];
        const isRegex = !prev || /[=({\[,:;!&|?+\-*%^~<>]/.test(prev) ||
          ['return', 'case', 'typeof', 'instanceof', 'void', 'delete', 'throw', 'do', 'else', 'yield', 'await'].includes(prevWord);
        if (isRegex) {
          state = 'REGEX';
        }
        out += ch;
        i++;
      } else if (ch === '}' && templateDepth.length > 0) {
        templateDepth[templateDepth.length - 1]--;
        if (templateDepth[templateDepth.length - 1] === 0) {
          templateDepth.pop();
          state = 'TEMPLATE';
        }
        out += ch;
        i++;
      } else if (ch === '{' && templateDepth.length > 0) {
        templateDepth[templateDepth.length - 1]++;
        out += ch;
        i++;
      } else {
        out += ch;
        i++;
      }
    } else if (state === 'SINGLE_QUOTE') {
      out += ch;
      if (ch === '\\') {
        out += next || '';
        i += 2;
      } else {
        if (ch === "'") state = 'CODE';
        i++;
      }
    } else if (state === 'DOUBLE_QUOTE') {
      out += ch;
      if (ch === '\\') {
        out += next || '';
        i += 2;
      } else {
        if (ch === '"') state = 'CODE';
        i++;
      }
    } else if (state === 'TEMPLATE') {
      out += ch;
      if (ch === '\\') {
        out += next || '';
        i += 2;
      } else if (ch === '$' && next === '{') {
        out += next;
        templateDepth.push(1);
        state = 'CODE';
        i += 2;
      } else if (ch === '`') {
        state = 'CODE';
        i++;
      } else {
        i++;
      }
    } else if (state === 'REGEX') {
      out += ch;
      if (ch === '\\') {
        out += next || '';
        i += 2;
      } else if (ch === '[') {
        state = 'REGEX_CLASS';
        i++;
      } else if (ch === '/') {
        state = 'CODE';
        i++;
      } else {
        i++;
      }
    } else if (state === 'REGEX_CLASS') {
      out += ch;
      if (ch === '\\') {
        out += next || '';
        i += 2;
      } else if (ch === ']') {
        state = 'REGEX';
        i++;
      } else {
        i++;
      }
    } else if (state === 'LINE_COMMENT') {
      if (ch === '\n' || ch === '\r') {
        out += ch;
        state = 'CODE';
      }
      i++;
    } else if (state === 'BLOCK_COMMENT') {
      if (ch === '*' && next === '/') {
        state = 'CODE';
        i += 2;
      } else {
        if (ch === '\n' || ch === '\r') out += ch;
        i++;
      }
    }
  }

  // 3. Clean up trailing spaces and collapse excess empty lines left by deleted comments
  const lines = out.split(/\r?\n/).map(l => l.trimEnd());
  const cleaned = [];
  let emptyCount = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      emptyCount++;
      if (emptyCount <= 1) cleaned.push('');
    } else {
      emptyCount = 0;
      cleaned.push(line);
    }
  }
  return cleaned.join('\n');
}

console.log('[2/4] Parsing and stripping comments safely...');
const cleanedCode = stripComments(originalCode);

console.log('[3/4] Validating JavaScript syntax with Node VM...');
try {
  new vm.Script(cleanedCode);
  console.log('✅ Syntax validation passed! Zero syntax errors.');
} catch (err) {
  console.error('❌ Validation failed! index.js was NOT modified:', err.message);
  process.exit(1);
}

// 4. Save clean index.js
fs.writeFileSync(filePath, cleanedCode, 'utf8');
console.log(`[4/4] Done! ${filePath} is now completely clean without any comments!`);
