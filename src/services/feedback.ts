import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface FeedbackInput {
  userId: string;
  /** Account email if the user opted in to be contacted; null otherwise. */
  userEmail: string | null;
  text: string;
  locale?: string;
}

/**
 * Persist user feedback to the Firestore `feedback` collection.
 * The write is guarded by firestore.rules: only an authenticated user may
 * create a doc whose `userId` matches their own UID. No client-side read is
 * allowed, so the developer reads submissions from the Firebase console.
 */
export async function submitFeedback(input: FeedbackInput): Promise<void> {
  await addDoc(collection(db, 'feedback'), {
    userId: input.userId,
    userEmail: input.userEmail,
    text: input.text,
    locale: input.locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en'),
    platform: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    createdAt: serverTimestamp(),
  });
}
