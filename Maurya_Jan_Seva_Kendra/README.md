# Maurya Jan Seva Kendra bundle

Files:
- `index.html`: redesigned responsive Hindi/English website, custom SVG service icons, sticky header, welcome dialog, Firebase login and customer search UI.
- `firestore.rules`: blocks browser-side writes; database mutations should go through verified server functions.
- `functions/index.js`: HTTP Cloud Functions with Firebase ID-token verification, role checks, search, approval, archive/restore, and audit log.
- `functions/package.json`: server dependencies.

## IMPORTANT: not yet production-complete
The public customer registration endpoint deliberately returns a disabled message. A secure public signup flow needs rate limiting / App Check / abuse controls before deployment. Billing and report cards are visual placeholders and do not record real transactions. Do not use this as a live billing system yet.

## Setup
1. Back up the GitHub repository and any Firestore data first.
2. In Firebase Authentication, enable Email/Password and create your own admin login.
3. Before applying restrictive rules, create `users/{YOUR_AUTH_UID}` in Firestore with fields: `uid` string, `name` string, `email` string, `role` string=`admin`, `status` string=`active`. Only the project owner should bootstrap the first admin.
4. Install Firebase CLI, run `firebase login`, then `firebase init functions firestore` for project `maurya-jan-seva-kendra`, JavaScript and Node 20. Put the supplied functions files in the generated functions folder.
5. Deploy: `firebase deploy --only firestore:rules,functions`. Cloud Functions deployment may require a Firebase billing plan; check current costs before proceeding.
6. Publish `index.html` to the repository root as `index.html`.
7. Test with test accounts first: admin login, role denial, search, approve, archive, restore. Do not enter real customer data until tests pass.

The first admin is a one-time manual bootstrap because public users must never be allowed to assign themselves admin roles. Firestore rules do not allow clients to directly mutate roles or customer records.
