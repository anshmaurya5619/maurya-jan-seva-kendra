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

function cardData(uid, schoolId='', overrides={}) {
  return {
    studentName:'', studentId:'', fatherName:'', motherName:'',
    schoolId, schoolName:'', schoolAddress:'', schoolPhone:'',
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
