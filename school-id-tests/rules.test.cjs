const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {initializeTestEnvironment, assertSucceeds, assertFails} = require('@firebase/rules-unit-testing');
const {doc, setDoc, updateDoc, deleteDoc, serverTimestamp, deleteField, writeBatch, getDoc} = require('firebase/firestore');

const PROJECT_ID = 'demo-mjk-school-id-rules';
const RULES = fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8');
let env;

function profile(uid, role='admin', status='active') {
  return {uid, name:'Test '+role, email:uid+'@example.test', role, status,
    createdByUid:uid, createdAt:serverTimestamp(), updatedAt:serverTimestamp()};
}

function schoolData(uid, name='Sample School') {
  return {
    name, schoolAddress:'', schoolPhone:'',
    cardTemplateLandscape:'', cardTemplatePortrait:'',
    templateMappingLandscape:{}, templateMappingPortrait:{},
    createdByUid:uid, createdByName:'Test Admin',
    createdAt:serverTimestamp(), updatedAt:serverTimestamp(),
    updatedByUid:uid, updatedByName:'Test Admin'
  };
}

function cscConfig(uid, websiteUrl='https://client-example.test') {
  return {
    websiteName:'Client CSC Website',
    websiteUrl,
    updatedAt:serverTimestamp(),
    updatedByUid:uid,
    updatedByName:'Test Admin'
  };
}

function cscLinkData(uid, name='Client Portal', url='https://portal-example.test') {
  return {
    name, url, isActive:true,
    createdAt:serverTimestamp(), createdByUid:uid, createdByName:'Test Admin',
    updatedAt:serverTimestamp(), updatedByUid:uid, updatedByName:'Test Admin'
  };
}

function cscLinkHistory(uid, action='created', name='Client Portal', url='https://portal-example.test') {
  return {
    action, byUid:uid, byName:'Test Actor', at:serverTimestamp(),
    details:'Test '+action, websiteName:name, websiteUrl:url
  };
}

function cardData(uid, schoolId='', overrides={}) {
  return {
    studentName:'', studentId:'', fatherName:'', motherName:'',
    schoolId, schoolName:'', schoolAddress:'', schoolPhone:'', language:'hi',
    className:'', section:'', rollNumber:'', dob:'', phone:'', academicYear:'',
    studentPhoto:'', schoolLogo:'', orientation:'landscape',
    createdByUid:uid, createdByName:'Test Admin',
    createdAt:serverTimestamp(), updatedAt:serverTimestamp(),
    updatedByUid:uid, updatedByName:'Test Admin', deleted:false,
    ...overrides
  };
}

async function seedUser(uid, role='admin', status='active') {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', uid), profile(uid, role, status));
  });
}
function dbFor(uid='admin-user') {
  return env.authenticatedContext(uid, {email:uid+'@example.test'}).firestore();
}

describe('School ID Firestore rules', function () {
  before(async function () {
    env = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {rules: RULES}
    });
  });
  after(async function () { await env.cleanup(); });
  beforeEach(async function () {
    await env.clearFirestore();
    await seedUser('admin-user', 'admin', 'active');
    await seedUser('worker-user', 'worker', 'active');
    await seedUser('inactive-user', 'worker', 'inactive');
  });

  it('allows anonymous visitors to read only the public CSC Kendra config path', async function () {
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'publicSiteConfig', 'cscKendra'), cscConfig('admin-user'));
    });
    const anon = env.unauthenticatedContext().firestore();
    const saved = await assertSucceeds(getDoc(doc(anon, 'publicSiteConfig', 'cscKendra')));
    assert.equal(saved.data().websiteName, 'Client CSC Website');
    await assertFails(getDoc(doc(anon, 'publicSiteConfig', 'privateConfig')));
  });

  it('allows only an admin to save an http(s) CSC Kendra URL', async function () {
    const adminDb = dbFor('admin-user');
    await assertSucceeds(setDoc(doc(adminDb, 'publicSiteConfig', 'cscKendra'), cscConfig('admin-user')));
    const workerDb = dbFor('worker-user');
    await assertFails(setDoc(doc(workerDb, 'publicSiteConfig', 'cscKendra'), cscConfig('worker-user')));
    await assertFails(setDoc(doc(adminDb, 'publicSiteConfig', 'cscKendra'), cscConfig('admin-user', 'javascript:alert(1)')));
  });

  it('keeps CSC websites in a staff directory with admin-only editing and immutable per-link history', async function () {
    const adminDb = dbFor('admin-user');
    const workerDb = dbFor('worker-user');
    const anonDb = env.unauthenticatedContext().firestore();
    const linkRef = doc(adminDb, 'cscKendraLinks', 'portal-1');

    await assertSucceeds(setDoc(linkRef, cscLinkData('admin-user')));
    await assertSucceeds(setDoc(doc(adminDb, 'cscKendraLinks', 'portal-1', 'history', 'created-1'),
      cscLinkHistory('admin-user', 'created')));
    await assertSucceeds(updateDoc(linkRef, {
      name:'Corrected Portal', url:'https://portal-example.test/updated', isActive:true,
      updatedAt:serverTimestamp(), updatedByUid:'admin-user', updatedByName:'Test Admin'
    }));
    await assertSucceeds(setDoc(doc(workerDb, 'cscKendraLinks', 'portal-1', 'history', 'opened-1'),
      cscLinkHistory('worker-user', 'opened', 'Corrected Portal', 'https://portal-example.test/updated')));

    await assertFails(setDoc(doc(workerDb, 'cscKendraLinks', 'worker-created'), cscLinkData('worker-user')));
    await assertFails(updateDoc(linkRef, {
      name:'Worker Edit', url:'https://portal-example.test/updated', isActive:true,
      updatedAt:serverTimestamp(), updatedByUid:'worker-user', updatedByName:'Test Worker'
    }));
    await assertFails(updateDoc(linkRef, {
      url:'javascript:alert(1)', updatedAt:serverTimestamp(),
      updatedByUid:'admin-user', updatedByName:'Test Admin'
    }));
    await assertFails(deleteDoc(linkRef));
    await assertFails(updateDoc(doc(adminDb, 'cscKendraLinks', 'portal-1', 'history', 'created-1'), {details:'tampered'}));
    await assertSucceeds(getDoc(doc(workerDb, 'cscKendraLinks', 'portal-1')));
    await assertFails(getDoc(doc(anonDb, 'cscKendraLinks', 'portal-1')));
    await assertFails(getDoc(doc(anonDb, 'cscKendraLinks', 'portal-1', 'history', 'created-1')));
  });

  it('allows staff to correct a school and propagate its new details to linked cards with audit history', async function () {
    const db = dbFor();
    const schoolRef = doc(db, 'schoolIdSchools', 'school-to-correct');
    const cardRef = doc(db, 'schoolIdCards', 'card-to-correct');
    await assertSucceeds(setDoc(schoolRef, schoolData('admin-user', 'Wrong School')));
    await assertSucceeds(setDoc(cardRef, cardData('admin-user', 'school-to-correct', {
      studentName:'Test Student', schoolName:'Wrong School', schoolAddress:'Old address', schoolPhone:'111'
    })));

    const change = writeBatch(db);
    change.update(schoolRef, {
      name:'Correct School', schoolAddress:'New address', schoolPhone:'222',
      updatedAt:serverTimestamp(), updatedByUid:'admin-user', updatedByName:'Test Admin'
    });
    change.set(doc(db, 'schoolIdSchools', 'school-to-correct', 'history', 'edit-1'), {
      action:'updated', byUid:'admin-user', byName:'Test Admin', at:serverTimestamp(),
      details:'School rename test', schoolName:'Correct School', schoolAddress:'New address', schoolPhone:'222'
    });
    change.update(cardRef, {
      schoolId:'school-to-correct', schoolName:'Correct School', schoolAddress:'New address', schoolPhone:'222',
      updatedAt:serverTimestamp(), updatedByUid:'admin-user', updatedByName:'Test Admin'
    });
    change.set(doc(db, 'schoolIdCards', 'card-to-correct', 'history', 'rename-1'), {
      action:'updated', byUid:'admin-user', byName:'Test Admin', at:serverTimestamp(),
      details:'School name/details corrected'
    });
    await assertSucceeds(change.commit());
    const updatedCard = await assertSucceeds(getDoc(cardRef));
    assert.equal(updatedCard.data().schoolName, 'Correct School');
    const savedHistory = await assertSucceeds(getDoc(doc(db, 'schoolIdSchools', 'school-to-correct', 'history', 'edit-1')));
    assert.equal(savedHistory.data().schoolName, 'Correct School');
  });

  it('allows an active staff member to create a school registry record', async function () {
    const db = dbFor();
    await assertSucceeds(setDoc(doc(db, 'schoolIdSchools', 'school-1'), schoolData('admin-user')));
    const saved = await assertSucceeds(getDoc(doc(db, 'schoolIdSchools', 'school-1')));
    assert.equal(saved.data().name, 'Sample School');
  });

  it('allows all-empty optional card fields and writes an audit history entry atomically', async function () {
    const db = dbFor();
    const batch = writeBatch(db);
    const card = doc(db, 'schoolIdCards', 'card-empty');
    batch.set(card, cardData('admin-user'));
    batch.set(doc(db, 'schoolIdCards', 'card-empty', 'history', 'created-1'), {
      action:'created', byUid:'admin-user', byName:'Test Admin',
      at:serverTimestamp(), details:'Optional fields test'
    });
    await assertSucceeds(batch.commit());
    const saved = await assertSucceeds(getDoc(card));
    assert.equal(saved.data().studentName, '');
    assert.equal(saved.data().studentPhoto, '');
  });

  it('stores only the selected Hindi or English card language', async function () {
    const db = dbFor();
    const hindiRef = doc(db, 'schoolIdCards', 'card-language-hi');
    const englishRef = doc(db, 'schoolIdCards', 'card-language-en');
    await assertSucceeds(setDoc(hindiRef, cardData('admin-user', '', {language:'hi'})));
    await assertSucceeds(setDoc(englishRef, cardData('admin-user', '', {language:'en'})));
    const hindi = await assertSucceeds(getDoc(hindiRef));
    const english = await assertSucceeds(getDoc(englishRef));
    assert.equal(hindi.data().language, 'hi');
    assert.equal(english.data().language, 'en');
    await assertFails(setDoc(doc(db, 'schoolIdCards', 'card-language-invalid'),
      cardData('admin-user', '', {language:'fr'})));
  });

  it('preserves soft-delete and restore for legacy cards without a language field', async function () {
    await env.withSecurityRulesDisabled(async context => {
      const legacy = cardData('admin-user', '', {studentName:'Legacy Student'});
      delete legacy.language;
      await setDoc(doc(context.firestore(), 'schoolIdCards', 'legacy-card'), legacy);
    });
    const db = dbFor();
    const ref = doc(db, 'schoolIdCards', 'legacy-card');
    await assertSucceeds(updateDoc(ref, {
      deleted:true, deletedAt:serverTimestamp(), deletedByUid:'admin-user', deletedByName:'Test Admin',
      updatedAt:serverTimestamp(), updatedByUid:'admin-user', updatedByName:'Test Admin'
    }));
    await assertSucceeds(updateDoc(ref, {
      deleted:false, deletedAt:deleteField(), deletedByUid:deleteField(), deletedByName:deleteField(),
      updatedAt:serverTimestamp(), updatedByUid:'admin-user', updatedByName:'Test Admin'
    }));
  });

  it('allows a card associated with an existing school', async function () {
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'schoolIdSchools', 'school-2'), schoolData('admin-user', 'Second School'));
    });
    const db = dbFor();
    await assertSucceeds(setDoc(doc(db, 'schoolIdCards', 'card-school'), cardData('admin-user', 'school-2', {
      studentName:'A Student', schoolName:'Second School'
    })));
  });

  it('rejects a card with an unknown school reference', async function () {
    const db = dbFor();
    await assertFails(setDoc(doc(db, 'schoolIdCards', 'card-bad-school'), cardData('admin-user', 'not-created')));
  });

  it('rejects writes by inactive staff and anonymous reads', async function () {
    const inactiveDb = dbFor('inactive-user');
    await assertFails(setDoc(doc(inactiveDb, 'schoolIdSchools', 'nope'), schoolData('inactive-user')));
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'schoolIdCards', 'secret')));
    await assertFails(getDoc(doc(anon, 'schoolIdSchools', 'school-1')));
  });

  it('retains soft-delete/restore history behavior and denies permanent card deletion', async function () {
    const db = dbFor();
    const ref = doc(db, 'schoolIdCards', 'card-soft-delete');
    const batch = writeBatch(db);
    batch.set(ref, cardData('admin-user', '', {studentName:'Soft Delete Test'}));
    batch.set(doc(db, 'schoolIdCards', 'card-soft-delete', 'history', 'created-1'), {
      action:'created', byUid:'admin-user', byName:'Test Admin',
      at:serverTimestamp(), details:'Create card'
    });
    await assertSucceeds(batch.commit());

    await assertSucceeds(updateDoc(ref, {
      deleted:true, deletedAt:serverTimestamp(), deletedByUid:'admin-user', deletedByName:'Test Admin',
      updatedAt:serverTimestamp(), updatedByUid:'admin-user', updatedByName:'Test Admin'
    }));
    await assertSucceeds(updateDoc(ref, {
      deleted:false, deletedAt:deleteField(), deletedByUid:deleteField(), deletedByName:deleteField(),
      updatedAt:serverTimestamp(), updatedByUid:'admin-user', updatedByName:'Test Admin'
    }));
    await assertFails(deleteDoc(ref));
  });
});
