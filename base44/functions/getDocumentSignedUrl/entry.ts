import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const document_id = body?.document_id;
    if (!document_id || typeof document_id !== 'string' || document_id.length > 100) {
      return Response.json({ error: 'Invalid request' }, { status: 400 });
    }

    // Fetch the document
    const docs = await base44.asServiceRole.entities.Document.filter({ id: document_id });
    if (docs.length === 0) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }
    const doc = docs[0];

    // Authorization check: user must be a member of the document's account
    const members = await base44.entities.AccountMember.filter({ user_id: user.id, status: 'פעיל' });
    const userAccountIds = members.map(m => m.account_id);

    // Personal document: check user_id. Vehicle/account document: check account_id.
    const isPersonalDoc = !!doc.user_id && !doc.account_id;
    const isAuthorized = isPersonalDoc
      ? doc.user_id === user.id
      : userAccountIds.includes(doc.account_id);

    if (!isAuthorized) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // If it's a private file URI (starts with private://)
    if (doc.file_url && doc.file_url.startsWith('private://')) {
      const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
        file_uri: doc.file_url,
        expires_in: 300, // 5 minutes
      });
      return Response.json({ signed_url });
    }

    // Legacy public URL — return as-is (migration to private is gradual)
    return Response.json({ signed_url: doc.file_url });
  } catch (error) {
    console.error('getDocumentSignedUrl error:', error.message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});