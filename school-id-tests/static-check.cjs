const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

function getBetween(source, start, end) {
  const a = source.indexOf(start);
  assert.notEqual(a, -1, 'Missing start anchor: ' + start);
  const b = source.indexOf(end, a);
  assert.notEqual(b, -1, 'Missing end anchor: ' + end);
  return source.slice(a, b);
}

const schoolForm = getBetween(html, '<form id="schoolIdForm">', '</form>');
assert.equal((schoolForm.match(/\brequired\b/g) || []).length, 0, 'School ID fields must be optional');

const script = getBetween(html, '/* MJK_SCHOOL_ID_PREVIEW_HANDLER_V2 */', '</script><script>');
assert.doesNotThrow(() => new Function(script), 'School ID handler must parse as JavaScript');

const ids = new Set(Array.from(html.matchAll(/\bid=["']([^"']+)["']/g), m => m[1]));
const referencedIds = Array.from(script.matchAll(/byId\(['"]([^'"]+)['"]\)/g), m => m[1]);
const missingIds = [...new Set(referencedIds.filter(id => !ids.has(id))];
assert.deepEqual(missingIds, [], 'School ID handler refers to missing elements');

assert.equal((html.match(/Hamjapur Pathan/g) || []).length, 2, 'Contact and receipt address spelling should be corrected exactly twice');
assert.equal(html.includes('Hamjapur Patahan'), false, 'Old address spelling must be gone');
assert.ok(html.includes('schoolIdSchools'), 'School registry functionality is required');
assert.ok(html.includes('sidCardTemplateFile'), 'Custom card image upload should exist');
assert.ok(html.includes('templatePositions'), 'Custom template field positions should be configurable and reusable');
assert.ok(html.includes('schoolIdBulkPrintBtn'), 'Bulk print control should exist');
assert.ok(html.includes('printSchoolIdCardsBulk'), 'Bulk printing should use one print job');
assert.ok(html.includes("row('School Phone',d.schoolPhone)"), 'School phone must have a separate labeled row');
assert.ok(html.includes("row('Parent Mobile',d.phone)"), 'Parent mobile must have a separate labeled row');
assert.ok(!script.includes('d.phone||d.schoolPhone'), 'Phone numbers must not be appended to the footer');

const printCss = getBetween(script, 'function printCardCSS(){', 'async function waitForPrintAssets');
assert.equal(printCss.includes('@page{size:A4 portrait;margin:7mm}'), false, 'A4 page rule must not override single-card CR80 printing');
assert.ok(script.includes("printCardCSS()+'@page{size:A4 portrait;margin:7mm}'"), 'Bulk print must explicitly set its A4 page size');
assert.ok(script.includes('await w.document.fonts.ready'), 'Print should wait for fonts');
assert.ok(script.includes('img.decode'), 'Print should wait for images');

const schoolRules = getBetween(rules, 'match /schoolIdCards/{cardId}', 'match /{document=**}');
assert.ok(rules.includes('match /schoolIdSchools/{schoolId}'), 'School registry rules must be present');
assert.ok(schoolRules.includes("request.resource.data.schoolId is string"), 'Cards should be associated with a school');
assert.equal(schoolRules.includes('request.resource.data.studentName.size() > 0'), false, 'Student name must be optional');
assert.equal(schoolRules.includes('request.resource.data.schoolName.size() > 0'), false, 'School name must be optional');
assert.ok(schoolRules.includes('allow delete: if false;'), 'Permanent card deletion must remain denied');
assert.ok(rules.includes('match /{document=**} { allow read, write: if false; }'), 'Default-deny rule must remain');

console.log('PASS: School ID static checks');
