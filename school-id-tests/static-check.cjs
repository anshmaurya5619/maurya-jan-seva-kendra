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
const missingIds = [...new Set(referencedIds.filter(id => !ids.has(id)))];
assert.deepEqual(missingIds, [], 'School ID handler refers to missing elements');

assert.equal((html.match(/Hamjapur Pathan/g) || []).length, 2, 'Contact and receipt address spelling should be corrected exactly twice');
assert.equal(html.includes('Hamjapur Patahan'), false, 'Old address spelling must be gone');
assert.ok(html.includes('schoolIdSchools'), 'School registry functionality is required');
const publicNav = getBetween(html, '<nav class="nav">', '</nav>');
assert.equal(publicNav.includes('cscKendraNav'), false, 'CSC Kendra must not be shown in the public header');
assert.ok(html.includes('<button data-page="csc-kendra" id="cscKendraNav"'), 'CSC Kendra must open the authenticated internal manager page');
assert.ok(html.includes('id="cscKendraLinkName"') && html.includes('id="cscKendraLinkUrl"'), 'Admin must be able to add/edit multiple website links');
assert.ok(html.includes("doc(db,'cscKendraLinks'"), 'Saved CSC sites must use a dedicated link collection');
assert.ok(html.includes("doc(db,'publicSiteConfig','cscKendra')") && html.includes("'legacy-cscKendra'"), 'Existing single-link settings must be preserved through migration');
assert.ok(html.includes('data-csc-open=') && html.includes('target="_blank" rel="noopener noreferrer"'), 'Opening an external link must be an explicit new-tab action');
assert.equal(html.includes('window.location.assign(url)'), false, 'CSC Kendra must not replace the main website');
assert.ok(html.includes('data-csc-edit=') && html.includes('data-csc-history='), 'Each saved website must have Edit and History actions');
assert.ok(html.includes("actionNames={created:'वेबसाइट जोड़ी गई',updated:'वेबसाइट Edit हुई',opened:'वेबसाइट खोली गई'}"), 'Website history must track add, edit and open events');
assert.ok(html.includes("['http:','https:'].includes(u.protocol)"), 'External links must be restricted to http(s)');
assert.ok(html.includes("if(!admin()||!user)return toast('लिंक सेव करने का अधिकार केवल Admin को है।')"), 'Only admin may add or edit CSC links');

assert.ok(html.includes('id="schoolIdSchoolEditForm"') && html.includes('id="schoolIdEditName"'), 'School registry must offer an explicit name-edit form');
assert.ok(html.includes('स्कूल नाम/विवरण सुधार'), 'School edits should propagate to connected card records and audit history');
assert.ok(html.includes('max-width:520px;aspect-ratio:1.586/1'), 'Landscape editor preview should be wider');
assert.ok(html.includes('grid-template-areas:"details photo"'), 'Landscape card details and student photo must use separate columns');
assert.ok(html.includes('id="sidPreviewPhotoSlot"'), 'Card preview must reserve a visible photo slot');
assert.ok(html.includes('school-id-card-preview .school-id-details{grid-area:details;display:flex'), 'Card information must fill the body area');
assert.ok(html.includes('id="sidLanguage"') && html.includes("sidLanguage:'language'"), 'Card language selector must save the selected language');
assert.ok(!html.includes('id="sidStudentId"') && !html.includes('Student ID'), 'Student ID must be removed from School ID form and labels');
assert.ok(html.includes("templatePositions[orientation]=defaultTemplatePositions(orientation)"), 'Uploaded design must get automatic field positions');
assert.ok(html.includes('function defaultTemplatePositions(orientation'), 'Landscape and portrait templates need separate default layouts');
assert.ok(html.includes("d.studentId=''"), 'Preserve legacy database shape without showing Student ID');
assert.ok(html.includes('font-size:6.4pt;line-height:1.12'), 'Printed card text should fit CR80 dimensions with readable sizing');
assert.ok(html.includes('sidCardTemplateFile'), 'Custom card image upload should exist');
assert.ok(html.includes('background:linear-gradient(145deg,#1d3b63 0%,#142744 58%,#0e1c33 100%)'), 'School ID preview must use the site dark theme');
assert.ok(html.includes("el.textContent=value||'—'"), 'Empty editor preview must show preview-only label placeholders');
assert.ok(html.includes('background:linear-gradient(145deg,#1d3b63,#142744 58%,#0e1c33)'), 'Printed default cards must use high-contrast theme colors');
assert.ok(html.includes('accept="image/*,application/pdf"') && html.includes('pdfTemplateToImage'), 'Custom card PDF upload should rasterize the first page');
assert.ok(html.includes('templatePositions'), 'Custom template field positions should be configurable and reusable');
assert.ok(html.includes('schoolIdBulkPrintBtn'), 'Bulk print control should exist');
assert.ok(html.includes('printSchoolIdCardsBulk'), 'Bulk printing should use one print job');
assert.ok(html.includes("row('schoolPhone',d.schoolPhone)"), 'School phone must have a separate labeled row');
assert.ok(html.includes("row('phone',d.phone)"), 'Parent mobile must have a separate labeled row');
assert.ok(!script.includes('d.phone||d.schoolPhone'), 'Phone numbers must not be appended to the footer');

const printCss = getBetween(script, 'function printCardCSS(){', 'async function waitForPrintAssets');
assert.equal(printCss.includes('@page{size:A4 portrait;margin:7mm}'), false, 'A4 page rule must not override single-card CR80 printing');
assert.ok(script.includes("printCardCSS()+'@page{size:A4 portrait;margin:7mm}'"), 'Bulk print must explicitly set its A4 page size');
assert.ok(script.includes('await w.document.fonts.ready'), 'Print should wait for fonts');
assert.ok(script.includes('img.decode'), 'Print should wait for images');

const schoolRules = getBetween(rules, 'match /schoolIdCards/{cardId}', '// MJK_SCHOOL_ID_SCHOOL_REGISTRY_V1');
assert.ok(rules.includes('match /schoolIdSchools/{schoolId}'), 'School registry rules must be present');
assert.ok(rules.includes('match /cscKendraLinks/{linkId}'), 'Multi-link CSC rules must be present');
assert.ok(rules.includes('match /history/{historyId}'), 'Immutable school and website history rules must be present');
assert.ok(schoolRules.includes("request.resource.data.schoolId is string"), 'Cards should be associated with a school');
assert.equal(schoolRules.includes('request.resource.data.studentName.size() > 0'), false, 'Student name must be optional');
assert.equal(schoolRules.includes('request.resource.data.schoolName.size() > 0'), false, 'School name must be optional');
assert.ok(schoolRules.includes('allow delete: if false;'), 'Permanent card deletion must remain denied');
assert.ok(rules.includes('match /{document=**} { allow read, write: if false; }'), 'Default-deny rule must remain');

console.log('PASS: School ID static checks');
