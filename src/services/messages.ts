import {
  Timestamp,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { cleanMessage, validateMessage } from '../lib/validation';

export const MESSAGE_PAGE_SIZE = 30;

export interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  createdAtMs: number;
}

const messagesCol = (db: Firestore, groupId: string) => collection(db, 'groups', groupId, 'messages');

export function messageFromSnap(snap: DocumentSnapshot): ChatMessage | null {
  const data = snap.data();
  if (!data || typeof data.senderId !== 'string' || typeof data.text !== 'string') return null;
  if (!(data.createdAt instanceof Timestamp)) return null;
  return { id: snap.id, senderId: data.senderId, text: data.text, createdAtMs: data.createdAt.toMillis() };
}

/** Newest messages first; the UI reverses them. */
export function latestMessagesQuery(db: Firestore, groupId: string): Query {
  return query(messagesCol(db, groupId), orderBy('createdAt', 'desc'), limit(MESSAGE_PAGE_SIZE));
}

export async function fetchOlderMessages(
  db: Firestore,
  groupId: string,
  cursor: QueryDocumentSnapshot,
): Promise<{ messages: ChatMessage[]; cursor: QueryDocumentSnapshot | null; hasMore: boolean }> {
  const snap = await getDocs(query(messagesCol(db, groupId), orderBy('createdAt', 'desc'), startAfter(cursor), limit(MESSAGE_PAGE_SIZE)));
  const messages = snap.docs.map(messageFromSnap).filter((m): m is ChatMessage => m !== null);
  return { messages, cursor: snap.docs[snap.docs.length - 1] ?? null, hasMore: snap.size === MESSAGE_PAGE_SIZE };
}

/** Generate once per outgoing message and reuse it for retries. */
export function newMessageId(db: Firestore, groupId: string): string {
  return doc(messagesCol(db, groupId)).id;
}

/**
 * Sends a message with a client-chosen id inside a transaction: if a previous
 * attempt already landed, the retry is a no-op instead of a duplicate.
 * Transactions fail fast when offline, so nothing is reported as sent until
 * the server has it.
 */
export async function sendMessage(
  db: Firestore,
  input: { groupId: string; messageId: string; uid: string; text: string },
): Promise<'sent' | 'already-sent'> {
  const text = cleanMessage(input.text);
  const error = validateMessage(text);
  if (error) throw new Error(error);

  const messageRef = doc(messagesCol(db, input.groupId), input.messageId);
  const groupRef = doc(db, 'groups', input.groupId);
  return runTransaction(db, async (tx) => {
    const existing = await tx.get(messageRef);
    if (existing.exists()) return 'already-sent' as const;
    tx.set(messageRef, { senderId: input.uid, text, createdAt: serverTimestamp() });
    tx.update(groupRef, { lastMessageAt: serverTimestamp() });
    return 'sent' as const;
  });
}
