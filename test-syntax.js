const fs = require('fs');
const path = require('path');
const vm = require('vm');

['antispam-feature.js', 'verification-feature.js', 'fixed-stats-feature.js', 'invite-feature.js', 'index.js'].forEach(file => {
  const filePath = path.join(__dirname, file);
  const code = fs.readFileSync(filePath, 'utf8');
  try {
    new vm.Script(code);
    console.log(`✔ ${file} syntax check passed!`);
  } catch (err) {
    console.error(`❌ Syntax Error in ${file}:`, err.message);
    process.exit(1);
  }
});
